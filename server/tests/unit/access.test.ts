import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessGuest, guestScope } from '../../src/services/access.js';
import type { AuthUser, GuestRecord } from '../../src/domain.js';

const baseUser = (patch: Partial<AuthUser>): AuthUser => ({
  id: 'user-bob',
  username: 'bob',
  displayName: 'Bob',
  departmentId: 'dept-dev',
  roleId: 'role-operator',
  roleName: 'operator',
  roleScope: 'own',
  permissions: ['guest.read'],
  status: 'active',
  ...patch,
});

const guest = (patch: Partial<GuestRecord>): GuestRecord => ({
  id: 'cluster-demo-101',
  clusterId: 'cluster-demo',
  clusterName: '演示集群',
  vmid: 101,
  type: 'qemu',
  name: 'web-01',
  node: 'pve-01',
  status: 'running',
  cores: 2,
  memoryMb: 2048,
  diskGb: 20,
  networkMbps: 0,
  template: false,
  ownerId: 'user-bob',
  ownerName: 'Bob',
  departmentId: 'dept-dev',
  departmentName: '研发中心',
  tags: [],
  uptimeSec: 100,
  lastSeenStatus: 'running',
  lastSyncAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch,
});

test('global 作用域可访问任意资源', () => {
  const user = baseUser({ roleScope: 'global' });
  assert.equal(canAccessGuest(user, guest({ ownerId: 'user-other', departmentId: 'dept-fin' })), true);
  assert.equal(guestScope(user), null);
});

test('department 作用域仅可访问同部门资源', () => {
  const user = baseUser({ roleScope: 'department' });
  assert.equal(canAccessGuest(user, guest({ departmentId: 'dept-dev', ownerId: 'user-alice' })), true);
  assert.equal(canAccessGuest(user, guest({ departmentId: 'dept-biz' })), false);
  assert.deepEqual(guestScope(user), { sql: 'g.department_id = ?', params: ['dept-dev'] });
});

test('own 作用域仅可访问本人归属资源', () => {
  const user = baseUser({ roleScope: 'own' });
  assert.equal(canAccessGuest(user, guest({ ownerId: 'user-bob' })), true);
  assert.equal(canAccessGuest(user, guest({ ownerId: 'user-alice' })), false);
  assert.deepEqual(guestScope(user), { sql: 'g.owner_id = ?', params: ['user-bob'] });
});
