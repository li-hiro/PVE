import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import type { AppConfig } from './config.js';
import { loadConfig } from './config.js';
import { closeDatabase, migrate, openDatabase, type Db } from './db/index.js';
import { seedDatabase } from './db/seed.js';
import { createServices } from './container.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/errors.js';
import { authRoutes } from './routes/auth.js';
import { organizationRoutes } from './routes/organization.js';
import { clusterRoutes } from './routes/clusters.js';
import { guestRoutes } from './routes/guests.js';
import { quotaRoutes } from './routes/quotas.js';
import { auditRoutes } from './routes/audit.js';
import { alertRoutes } from './routes/alerts.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { consoleRoutes } from './routes/console.js';
import { metaRoutes } from './routes/meta.js';

export interface BuildAppOptions {
  /** 覆盖环境变量中的配置，测试可借此注入内存数据库与固定密钥 */
  config?: Partial<AppConfig>;
  /** 复用外部数据库连接（例如测试中的 :memory: 实例） */
  db?: Db;
  logger?: FastifyServerOptions['logger'];
  /** 是否写入内置角色与演示数据，默认 true */
  seed?: boolean;
  /** 是否随应用启动周期同步，默认 false（由 main.ts 显式启动） */
  startSync?: boolean;
}

/**
 * 应用工厂：组装插件、服务、路由与错误处理。
 * 将构建与启动分离，便于集成测试直接使用 fastify.inject 驱动完整请求链路。
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = loadConfig(process.env, options.config ?? {});
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: true,
    bodyLimit: 8 * 1024 * 1024,
    // 请求日志由审计链负责记录，此处关闭 Fastify 自带访问日志。
    // 注：Fastify 5.12 提示该选项将在 6.0 迁移到 logController，此处在 5.x 内保持兼容。
    disableRequestLogging: true,
  });

  const db = options.db ?? openDatabase(config.databasePath);
  migrate(db);
  if (options.seed !== false) {
    seedDatabase(db, {
      demoMode: config.demoMode,
      adminPassword: config.bootstrapAdminPassword,
      demoPassword: config.demoUserPassword,
    });
  }

  const services = createServices(db, config, app.log);
  app.decorate('services', services);

  await app.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(websocket);

  await registerAuth(app, { db });
  registerErrorHandler(app);

  await app.register(authRoutes);
  await app.register(organizationRoutes);
  await app.register(clusterRoutes);
  await app.register(guestRoutes);
  await app.register(quotaRoutes);
  await app.register(auditRoutes);
  await app.register(alertRoutes);
  await app.register(dashboardRoutes);
  await app.register(consoleRoutes);
  await app.register(metaRoutes);

  app.addHook('onReady', async () => {
    if (options.startSync) services.sync.start();
  });

  app.addHook('onClose', async () => {
    services.sync.stop();
    services.registry.clear();
    if (!options.db) closeDatabase(db);
  });

  return app;
}
