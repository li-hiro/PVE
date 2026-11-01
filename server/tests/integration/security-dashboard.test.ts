import test from 'node:test';
import assert from 'node:assert/strict';
import { bearer, createTestApp, login, syncMockCluster } from '../helpers.js';

test('配额读取与调整按作用域生效并写入审计', async (t) => {
  const app = await createTestApp();
  t.after(async () => {
    await app.close();
  });
  const admin = await login(app, 'admin', 'Admin@12345');

  const list = await app.inject({ method: 'GET', url: '/api/v1/quotas', headers: bearer(admin.token) });
  assert.equal(list.statusCode, 200);
  const snapshots = list.json().data as Array<{ scopeType: string; scopeId: string; limits: { cpuCores: number | null } }>;
  assert.ok(snapshots.some((item) => item.scopeType === 'department' && item.scopeId === 'dept-dev'));
  assert.ok(snapshots.some((item) => item.scopeType === 'user' && item.scopeId === 'user-bob'));

  const update = await app.inject({
    method: 'PUT',
    url: '/api/v1/quotas',
    headers: bearer(admin.token),
    payload: { scopeType: 'department', scopeId: 'dept-fin', networkMbps: 320, guestLimit: 4 },
  });
  assert.equal(update.statusCode, 200);
  const after = update.json().data as { limits: { networkMbps: number; guestLimit: number } };
  assert.equal(after.limits.networkMbps, 320);
  assert.equal(after.limits.guestLimit, 4);

  const effective = await app.inject({
    method: 'GET',
    url: '/api/v1/quotas/effective?scopeType=department&scopeId=dept-fin',
    headers: bearer(admin.token),
  });
  assert.equal(effective.json().data.limits.networkMbps, 320);

  const events = app.services.audit.list({ action: 'quota.update', page: 1, pageSize: 5 });
  assert.equal(events.total, 1);
  assert.equal(events.items[0]?.result, 'success');
});

test('部门管理员无法调整其他部门配额', async (t) => {
  const app = await createTestApp();
  t.after(async () => {
    await app.close();
  });
  const alice = await login(app, 'alice', 'Demo@12345');

  const response = await app.inject({
    method: 'PUT',
    url: '/api/v1/quotas',
    headers: bearer(alice.token),
    payload: { scopeType: 'department', scopeId: 'dept-fin', cpuCores: 100 },
  });
  // alice 的 dept_admin 角色未授予 quota.manage，因此在权限层即被拒绝
  assert.equal(response.statusCode, 403);
});

test('审计链校验、检索与 CSV 导出', async (t) => {
  const app = await createTestApp();
  t.after(async () => {
    await app.close();
  });
  await syncMockCluster(app);
  const admin = await login(app, 'admin', 'Admin@12345');

  const verify = await app.inject({
    method: 'POST',
    url: '/api/v1/audit/verify',
    headers: bearer(admin.token),
    payload: {},
  });
  assert.equal(verify.statusCode, 200);
  assert.equal(verify.json().data.valid, true);

  const events = await app.inject({
    method: 'GET',
    url: '/api/v1/audit/events?pageSize=5',
    headers: bearer(admin.token),
  });
  assert.equal(events.statusCode, 200);
  assert.ok(events.json().meta.total >= 1);

  const stats = await app.inject({ method: 'GET', url: '/api/v1/audit/stats', headers: bearer(admin.token) });
  assert.equal(stats.statusCode, 200);
  assert.ok(stats.json().data.total >= 1);

  const csv = await app.inject({
    method: 'GET',
    url: '/api/v1/audit/export?format=csv&days=30',
    headers: bearer(admin.token),
  });
  assert.equal(csv.statusCode, 200);
  assert.match(String(csv.headers['content-type']), /text\/csv/);
  assert.match(String(csv.headers['content-disposition']), /attachment/);
  assert.match(csv.body, /seq,ts,actor,action,targetType,targetId,result/);
  assert.match(csv.body, /guest|cluster|auth/);

  const json = await app.inject({
    method: 'GET',
    url: '/api/v1/audit/export?format=json',
    headers: bearer(admin.token),
  });
  assert.equal(json.statusCode, 200);
  assert.equal(json.json().verification.valid, true);
});

test('监控面板聚合集群、资源、指标与告警数据', async (t) => {
  const app = await createTestApp();
  t.after(async () => {
    await app.close();
  });
  await syncMockCluster(app);
  const admin = await login(app, 'admin', 'Admin@12345');

  const overview = await app.inject({
    method: 'GET',
    url: '/api/v1/dashboard/overview',
    headers: bearer(admin.token),
  });
  assert.equal(overview.statusCode, 200);
  const data = overview.json().data as {
    clusters: Array<{ id: string; status: string }>;
    guests: { total: number; running: number; stopped: number; templates: number };
    nodes: Array<{ node: string; cpuPct: number }>;
    metrics: { points: Array<{ bucket: number }> };
  };
  assert.equal(data.clusters.length, 1);
  assert.equal(data.clusters[0]?.status, 'online');
  assert.equal(data.guests.total, 14);
  assert.ok(data.guests.running > 0);
  assert.equal(data.guests.templates, 2);
  assert.equal(data.nodes.length, 2);
  assert.ok(data.metrics.points.length >= 1);

  const metrics = await app.inject({
    method: 'GET',
    url: '/api/v1/dashboard/metrics?range=1h',
    headers: bearer(admin.token),
  });
  assert.equal(metrics.statusCode, 200);

  const badRange = await app.inject({
    method: 'GET',
    url: '/api/v1/dashboard/metrics?range=2h',
    headers: bearer(admin.token),
  });
  assert.equal(badRange.statusCode, 400);
});

test('资源阈值告警可查询、确认并留痕', async (t) => {
  const app = await createTestApp();
  t.after(async () => {
    await app.close();
  });
  await syncMockCluster(app);
  const admin = await login(app, 'admin', 'Admin@12345');

  app.services.alerts.evaluateNodes('cluster-demo', [
    { node: 'pve-01', cpuPct: 99, memPct: 98, diskPct: 99 },
  ]);
  const list = await app.inject({ method: 'GET', url: '/api/v1/alerts?pageSize=20', headers: bearer(admin.token) });
  assert.equal(list.statusCode, 200);
  const alerts = list.json().data as Array<{ id: string; rule: string; status: string; severity: string }>;
  assert.ok(alerts.length >= 3);
  const target = alerts[0];
  assert.ok(target);

  const ack = await app.inject({
    method: 'POST',
    url: `/api/v1/alerts/${target.id}/ack`,
    headers: bearer(admin.token),
  });
  assert.equal(ack.statusCode, 200);
  const after = await app.inject({ method: 'GET', url: `/api/v1/alerts/${target.id}`, headers: bearer(admin.token) });
  assert.equal(after.json().data.status, 'ack');

  const events = app.services.audit.list({ action: 'alert.ack', page: 1, pageSize: 5 });
  assert.equal(events.total, 1);

  const summary = await app.inject({ method: 'GET', url: '/api/v1/alerts/summary', headers: bearer(admin.token) });
  assert.ok(summary.json().data.total >= 2);
});

test('连续越权尝试触发异常行为告警', async (t) => {
  const app = await createTestApp();
  t.after(async () => {
    await app.close();
  });
  const carol = await login(app, 'carol', 'Demo@12345');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/guests',
      headers: bearer(carol.token),
      payload: {
        clusterId: 'cluster-demo',
        type: 'lxc',
        name: `denied-${attempt}`,
        node: 'pve-01',
        cores: 1,
        memoryMb: 512,
        diskGb: 8,
        storage: 'local-lvm',
      },
    });
    assert.equal(response.statusCode, 403);
  }

  const admin = await login(app, 'admin', 'Admin@12345');
  const alerts = await app.inject({
    method: 'GET',
    url: '/api/v1/alerts?category=anomaly',
    headers: bearer(admin.token),
  });
  const items = alerts.json().data as Array<{ rule: string; targetId: string }>;
  assert.ok(items.some((alert) => alert.rule === 'permission_denial_burst' && alert.targetId === 'user-carol'));
});
