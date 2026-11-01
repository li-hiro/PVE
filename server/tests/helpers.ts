import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';

/**
 * 集成测试基座：每次创建独立的内存数据库应用实例，互不干扰。
 */
export async function createTestApp(overrides: Partial<AppConfig> = {}): Promise<FastifyInstance> {
  const config = loadConfig(
    { NODE_ENV: 'test' },
    {
      databasePath: ':memory:',
      syncEnabled: false,
      demoMode: true,
      logLevel: 'silent',
      jwtSecret: 'virtgate-test-jwt-secret',
      encryptionKey: 'virtgate-test-encryption-key',
      bootstrapAdminPassword: 'Admin@12345',
      demoUserPassword: 'Demo@12345',
      ...overrides,
    },
  );
  const app = await buildApp({ config, seed: true });
  await app.ready();
  return app;
}

export interface LoginResult {
  token: string;
  user: Record<string, unknown>;
}

export async function login(app: FastifyInstance, username: string, password: string): Promise<LoginResult> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password },
  });
  if (response.statusCode !== 200) {
    throw new Error(`登录失败：${username} ${response.body}`);
  }
  const body = response.json() as { data: { token: string; user: Record<string, unknown> } };
  return { token: body.data.token, user: body.data.user };
}

export const bearer = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

/** 手动触发一次 Mock 集群同步，填充资源缓存与监控指标。 */
export async function syncMockCluster(app: FastifyInstance): Promise<void> {
  const reports = await app.services.sync.syncAll();
  const failed = reports.filter((report) => report.status !== 'ok');
  if (failed.length > 0) {
    throw new Error(`同步失败：${JSON.stringify(failed)}`);
  }
}
