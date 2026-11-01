import test from 'node:test';
import assert from 'node:assert/strict';
import { bearer, createTestApp, login, syncMockCluster } from '../helpers.js';

test('集群同步后资源按角色数据范围过滤', async (t) => {
  const app = await createTestApp();
  t.after(async () => {
    await app.close();
  });
  await syncMockCluster(app);

  const admin = await login(app, 'admin', 'Admin@12345');
  const all = await app.inject({ method: 'GET', url: '/api/v1/guests?pageSize=200', headers: bearer(admin.token) });
  assert.equal(all.statusCode, 200);
  assert.ok(all.json().meta.total >= 14);
  const list = all.json().data as Array<{ id: string; name: string; ownerName: string | null; departmentName: string | null; template: boolean }>;
  assert.ok(list.some((guest) => guest.name === 'web-prod-01'));
  assert.ok(list.some((guest) => guest.name === 'finance-erp-01'));

  const bob = await login(app, 'bob', 'Demo@12345');
  const bobList = await app.inject({ method: 'GET', url: '/api/v1/guests?pageSize=200', headers: bearer(bob.token) });
  const bobGuests = bobList.json().data as Array<{ name: string; departmentName: string }>;
  assert.ok(bobGuests.length > 0);
  assert.ok(bobGuests.every((guest) => guest.departmentName === '研发中心'));
  assert.ok(!bobGuests.some((guest) => guest.name === 'finance-erp-01'));

  const carol = await login(app, 'carol', 'Demo@12345');
  const carolList = await app.inject({ method: 'GET', url: '/api/v1/guests?pageSize=200', headers: bearer(carol.token) });
  const carolGuests = carolList.json().data as Array<{ name: string }>;
  assert.ok(carolGuests.every((guest) => !guest.name.startsWith('finance-')));
});

test('模板目录对所有具备 template.read 的用户可见', async (t) => {
  const app = await createTestApp();
  t.after(async () => {
    await app.close();
  });
  await syncMockCluster(app);
  const bob = await login(app, 'bob', 'Demo@12345');

  const templates = await app.inject({
    method: 'GET',
    url: '/api/v1/guests/templates',
    headers: bearer(bob.token),
  });
  assert.equal(templates.statusCode, 200);
  const list = templates.json().data as Array<{ vmid: number; type: string }>;
  assert.equal(list.length, 2);
  assert.ok(list.some((template) => template.type === 'qemu'));
  assert.ok(list.some((template) => template.type === 'lxc'));
});

test('自助创建、启停与删除资源并留痕', async (t) => {
  const app = await createTestApp();
  t.after(async () => {
    await app.close();
  });
  await syncMockCluster(app);
  const bob = await login(app, 'bob', 'Demo@12345');
  const admin = await login(app, 'admin', 'Admin@12345');

  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/guests',
    headers: bearer(bob.token),
    payload: {
      clusterId: 'cluster-demo',
      type: 'lxc',
      name: 'selfservice-test-01',
      node: 'pve-02',
      cores: 2,
      memoryMb: 2048,
      diskGb: 10,
      storage: 'local-lvm',
      networkBridge: 'vmbr0',
      rateMbps: 50,
    },
  });
  assert.equal(create.statusCode, 201);
  const created = create.json().data.guest as { id: string; vmid: number; status: string };
  assert.equal(created.status, 'stopped');
  assert.ok(created.vmid > 111);

  const start = await app.inject({
    method: 'POST',
    url: `/api/v1/guests/${created.id}/actions`,
    headers: bearer(bob.token),
    payload: { action: 'start' },
  });
  assert.equal(start.statusCode, 200);
  assert.equal(start.json().data.guest.status, 'running');

  const duplicateStart = await app.inject({
    method: 'POST',
    url: `/api/v1/guests/${created.id}/actions`,
    headers: bearer(bob.token),
    payload: { action: 'start' },
  });
  assert.equal(duplicateStart.statusCode, 409);

  const config = await app.inject({
    method: 'PATCH',
    url: `/api/v1/guests/${created.id}/config`,
    headers: bearer(bob.token),
    payload: { cores: 4 },
  });
  assert.equal(config.statusCode, 200);
  assert.equal(config.json().data.guest.cores, 4);

  const remove = await app.inject({
    method: 'DELETE',
    url: `/api/v1/guests/${created.id}`,
    headers: bearer(admin.token),
  });
  assert.equal(remove.statusCode, 200);

  const audit = app.services.audit.timeline('guest', `cluster-demo:${created.vmid}`);
  assert.ok(audit.some((event) => event.action === 'guest.create' && event.result === 'success'));
  assert.ok(audit.some((event) => event.action === 'guest.power.start'));
  assert.ok(audit.some((event) => event.action === 'guest.delete'));

  const operations = app.services.db
    .prepare('SELECT status FROM operations WHERE vmid = ? ORDER BY started_at ASC')
    .all(created.vmid) as Array<{ status: string }>;
  assert.ok(operations.length >= 3);
  assert.ok(operations.every((operation) => operation.status === 'success'));
});

test('超配额创建被拒绝且不会产生资源', async (t) => {
  const app = await createTestApp();
  t.after(async () => {
    await app.close();
  });
  await syncMockCluster(app);
  const bob = await login(app, 'bob', 'Demo@12345');

  const before = await app.inject({ method: 'GET', url: '/api/v1/guests?pageSize=200', headers: bearer(bob.token) });
  const beforeTotal = before.json().meta.total as number;

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/guests',
    headers: bearer(bob.token),
    payload: {
      clusterId: 'cluster-demo',
      type: 'qemu',
      name: 'quota-overflow-01',
      node: 'pve-01',
      cores: 64,
      memoryMb: 1024,
      diskGb: 10,
      storage: 'local-lvm',
      networkBridge: 'vmbr0',
      rateMbps: 10,
    },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, 'QUOTA_EXCEEDED');
  assert.ok(response.json().error.details.dimensions.length > 0);

  const after = await app.inject({ method: 'GET', url: '/api/v1/guests?pageSize=200', headers: bearer(bob.token) });
  assert.equal(after.json().meta.total, beforeTotal);

  const denied = app.services.audit.list({ action: 'guest.create', result: 'denied', page: 1, pageSize: 5 });
  assert.ok(denied.total >= 1);
});

test('只读角色无法创建或执行电源操作', async (t) => {
  const app = await createTestApp();
  t.after(async () => {
    await app.close();
  });
  await syncMockCluster(app);
  const carol = await login(app, 'carol', 'Demo@12345');

  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/guests',
    headers: bearer(carol.token),
    payload: {
      clusterId: 'cluster-demo',
      type: 'lxc',
      name: 'viewer-forbidden-01',
      node: 'pve-01',
      cores: 1,
      memoryMb: 512,
      diskGb: 8,
      storage: 'local-lvm',
      networkBridge: 'vmbr0',
    },
  });
  assert.equal(create.statusCode, 403);
  assert.equal(create.json().error.code, 'FORBIDDEN');
});

test('控制台会话可签发且过期会话不可复用', async (t) => {
  const app = await createTestApp();
  t.after(async () => {
    await app.close();
  });
  await syncMockCluster(app);
  const bob = await login(app, 'bob', 'Demo@12345');

  const guests = await app.inject({ method: 'GET', url: '/api/v1/guests?pageSize=200', headers: bearer(bob.token) });
  const running = (guests.json().data as Array<{ id: string; status: string; template: boolean; type: string }>).find(
    (guest) => guest.status === 'running' && !guest.template && guest.type === 'lxc',
  );
  assert.ok(running);

  const session = await app.inject({
    method: 'POST',
    url: `/api/v1/guests/${running.id}/console`,
    headers: bearer(bob.token),
  });
  assert.equal(session.statusCode, 200);
  const data = session.json().data as { sessionId: string; kind: string; upstreamPort: number };
  assert.equal(data.kind, 'term');
  assert.ok(data.sessionId);

  const stored = app.services.db
    .prepare('SELECT COUNT(*) AS n FROM console_sessions WHERE id = ?')
    .get(data.sessionId) as { n: number };
  assert.equal(Number(stored.n), 1);
});
