import { loadConfig } from './config.js';
import { buildApp } from './app.js';

const config = loadConfig();
const app = await buildApp({
  config: {
    port: config.port,
    host: config.host,
    databasePath: config.databasePath,
    logLevel: config.logLevel,
    demoMode: config.demoMode,
  },
  logger: { level: config.logLevel },
});

app.services.sync.start();

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, '正在关闭 VirtGate');
  app.services.sync.stop();
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  app.log.error({ reason }, '未处理的 Promise 拒绝');
});

await app.listen({ host: config.host, port: config.port });

app.log.info(
  {
    port: config.port,
    demoMode: config.demoMode,
    syncEnabled: config.syncEnabled,
    docs: '/api/v1/meta/bootstrap',
  },
  'VirtGate 已启动',
);
if (config.demoMode) {
  app.log.info(
    { admin: 'admin', demoUsers: ['alice', 'bob', 'carol', 'dave', 'frank', 'eve'] },
    '演示模式已启用：账号密码分别由 BOOTSTRAP_ADMIN_PASSWORD 与 DEMO_USER_PASSWORD 控制',
  );
}
