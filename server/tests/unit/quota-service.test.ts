import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, openDatabase } from '../../src/db/index.js';
import { seedDatabase } from '../../src/db/seed.js';
import { QuotaService } from '../../src/services/quota-service.js';
import { isAppError } from '../../src/lib/errors.js';

function setup(): { quotas: QuotaService } {
  const db = openDatabase(':memory:');
  migrate(db);
  seedDatabase(db, { demoMode: true, adminPassword: 'Admin@12345', demoPassword: 'Demo@12345' });
  return { quotas: new QuotaService(db) };
}

const request = (cores: number, memoryMb: number, storageGb: number, networkMbps: number, guestCount: number) => ({
  cpuCores: cores,
  memoryMb,
  storageGb,
  networkMbps,
  guestCount,
});

test('预占配额成功后可提交，提交后不再计入预占用量', () => {
  const { quotas } = setup();
  const snapshot = quotas.snapshot('user', 'user-bob', 'Bob');
  assert.equal(snapshot.limits.cpuCores, 24);
  assert.equal(snapshot.source, 'user');

  const reservation = quotas.reserve({
    scopeType: 'user',
    scopeId: 'user-bob',
    actorId: 'user-bob',
    clusterId: 'cluster-demo',
    vmid: null,
    request: request(4, 4096, 20, 100, 1),
    });
  assert.ok(reservation);
  const reserved = quotas.snapshot('user', 'user-bob', 'Bob');
  assert.equal(reserved.reserved.cpuCores, 4);

  quotas.commit(reservation);
  assert.equal(quotas.snapshot('user', 'user-bob', 'Bob').reserved.cpuCores, 0);
});

test('并发预占累加超过上限时抛出 QUOTA_EXCEEDED', () => {
  const { quotas } = setup();
  const first = quotas.reserve({
    scopeType: 'user',
    scopeId: 'user-bob',
    actorId: 'user-bob',
    clusterId: 'cluster-demo',
    vmid: null,
    request: request(12, 16384, 100, 100, 2),
  });
  assert.ok(first);

  assert.throws(
    () =>
      quotas.reserve({
        scopeType: 'user',
        scopeId: 'user-bob',
        actorId: 'user-bob',
        clusterId: 'cluster-demo',
        vmid: null,
        request: request(14, 1024, 10, 10, 1),
      }),
    (error: unknown) => isAppError(error) && error.code === 'QUOTA_EXCEEDED',
  );
});

test('释放预占后可重新占用相同额度', () => {
  const { quotas } = setup();
  const first = quotas.reserve({
    scopeType: 'user',
    scopeId: 'user-bob',
    actorId: 'user-bob',
    clusterId: 'cluster-demo',
    vmid: null,
    request: request(20, 1024, 10, 10, 1),
  });
  quotas.release(first);
  const second = quotas.reserve({
    scopeType: 'user',
    scopeId: 'user-bob',
    actorId: 'user-bob',
    clusterId: 'cluster-demo',
    vmid: null,
    request: request(20, 1024, 10, 10, 1),
    });
  assert.ok(second);
});

test('未配置策略的作用域返回无限制配额', () => {
  const { quotas } = setup();
  const snapshot = quotas.snapshot('department', 'dept-platform', '平台运维部');
  assert.equal(snapshot.source, 'none');
  assert.equal(snapshot.limits.cpuCores, null);
});

test('部门配额按部门作用域解析并记录继承关系', () => {
  const { quotas } = setup();
  const effective = quotas.resolveUser('user-carol', 'dept-biz');
  assert.equal(effective.source, 'department');
  assert.equal(effective.inherited, true);
  assert.equal(effective.limits.guestLimit, 6);
});
