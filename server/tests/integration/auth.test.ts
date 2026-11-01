import test from 'node:test';
import assert from 'node:assert/strict';
import { bearer, createTestApp, login } from '../helpers.js';

test('健康检查与引导信息无需认证即可访问', async (t) => {
  const app = await createTestApp();
  t.after(async () => {
    await app.close();
  });

  const health = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().status, 'ok');

  const bootstrap = await app.inject({ method: 'GET', url: '/api/v1/meta/bootstrap' });
  assert.equal(bootstrap.statusCode, 200);
  assert.equal(bootstrap.json().data.name, 'VirtGate');
  assert.equal(bootstrap.json().data.demoMode, true);
});

test('演示账号可登录并获取当前用户信息', async (t) => {
  const app = await createTestApp();
  t.after(async () => {
    await app.close();
  });

  const { token, user } = await login(app, 'admin', 'Admin@12345');
  assert.ok(token.length > 20);
  assert.equal(user.username, 'admin');
  assert.equal(user.roleScope, 'global');

  const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(token) });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().data.username, 'admin');
});

test('错误密码与无效令牌均被拒绝，失败登录进入审计链', async (t) => {
  const app = await createTestApp();
  t.after(async () => {
    await app.close();
  });

  const bad = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'wrong-password' },
  });
  assert.equal(bad.statusCode, 401);
  assert.equal(bad.json().error.code, 'UNAUTHENTICATED');

  const noToken = await app.inject({ method: 'GET', url: '/api/v1/guests' });
  assert.equal(noToken.statusCode, 401);

  const events = app.services.audit.list({ action: 'auth.login', result: 'failure', page: 1, pageSize: 5 });
  assert.ok(events.total >= 1);
});

test('停用账号无法登录', async (t) => {
  const app = await createTestApp();
  t.after(async () => {
    await app.close();
  });

  const admin = await login(app, 'admin', 'Admin@12345');
  const bob = await login(app, 'bob', 'Demo@12345');
  const bobId = bob.user.id as string;

  const disable = await app.inject({
    method: 'PATCH',
    url: `/api/v1/users/${bobId}`,
    headers: bearer(admin.token),
    payload: { status: 'disabled' },
  });
  assert.equal(disable.statusCode, 200);

  const relogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'bob', password: 'Demo@12345' },
  });
  assert.equal(relogin.statusCode, 401);
});
