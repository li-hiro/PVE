import bcrypt from 'bcryptjs';
import { allRows, runSql, type Db } from './index.js';
import { BUILTIN_ROLES } from '../modules/rbac/catalog.js';

interface SeedOptions {
  demoMode: boolean;
  adminPassword: string;
  demoPassword: string;
}

const DEPARTMENTS = [
  { id: 'dept-platform', name: '平台运维部', description: '平台基础设施与虚拟化运维' },
  { id: 'dept-dev', name: '研发中心', description: '应用研发与持续集成' },
  { id: 'dept-biz', name: '业务支持部', description: '业务系统与客户支持' },
  { id: 'dept-fin', name: '财务部', description: '财务系统与报表服务' },
];

const DEMO_USERS = [
  { username: 'alice', displayName: 'Alice · 研发管理员', departmentId: 'dept-dev', roleId: 'role-dept-admin' },
  { username: 'bob', displayName: 'Bob · 研发运维', departmentId: 'dept-dev', roleId: 'role-operator' },
  { username: 'carol', displayName: 'Carol · 业务只读', departmentId: 'dept-biz', roleId: 'role-viewer' },
  { username: 'dave', displayName: 'Dave · 财务运维', departmentId: 'dept-fin', roleId: 'role-operator' },
  { username: 'frank', displayName: 'Frank · 业务管理员', departmentId: 'dept-biz', roleId: 'role-dept-admin' },
  { username: 'eve', displayName: 'Eve · 合规审计员', departmentId: 'dept-platform', roleId: 'role-auditor' },
];

const QUOTA_SEEDS = [
  { scopeId: 'dept-dev', cpu: 32, memory: 65536, storage: 800, network: 1000, guests: 12 },
  { scopeId: 'dept-biz', cpu: 12, memory: 24576, storage: 320, network: 600, guests: 6 },
  { scopeId: 'dept-fin', cpu: 8, memory: 16384, storage: 240, network: 300, guests: 4 },
];

/**
 * 初始化内置角色、部门、管理员与演示数据。幂等执行，可安全重复调用。
 */
export function seedDatabase(db: Db, options: SeedOptions): void {
  const now = new Date().toISOString();

  for (const role of BUILTIN_ROLES) {
    const existing = db.prepare('SELECT id FROM roles WHERE id = ?').get(role.id) as { id: string } | undefined;
    if (existing) {
      runSql(
        db,
        'UPDATE roles SET name = ?, description = ?, scope = ?, permissions = ? WHERE id = ? AND builtin = 1',
        role.name,
        role.description,
        role.scope,
        JSON.stringify(role.permissions),
        role.id,
      );
    } else {
      runSql(
        db,
        'INSERT INTO roles (id, name, description, scope, permissions, builtin, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
        role.id,
        role.name,
        role.description,
        role.scope,
        JSON.stringify(role.permissions),
        now,
      );
    }
  }

  for (const dept of DEPARTMENTS) {
    runSql(
      db,
      'INSERT OR IGNORE INTO departments (id, name, description, created_at) VALUES (?, ?, ?, ?)',
      dept.id,
      dept.name,
      dept.description,
      now,
    );
  }

  const userCount = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (userCount === 0) {
    const adminHash = bcrypt.hashSync(options.adminPassword, 10);
    runSql(
      db,
      `INSERT INTO users (id, username, display_name, password_hash, department_id, role_id, status, email, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      'user-admin',
      'admin',
      '平台管理员',
      adminHash,
      'dept-platform',
      'role-platform-admin',
      'admin@virtgate.local',
      now,
    );
  }

  if (options.demoMode) {
    const demoHash = bcrypt.hashSync(options.demoPassword, 10);
    for (const demo of DEMO_USERS) {
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(demo.username) as { id: string } | undefined;
      if (existing) continue;
      runSql(
        db,
        `INSERT INTO users (id, username, display_name, password_hash, department_id, role_id, status, email, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        `user-${demo.username}`,
        demo.username,
        demo.displayName,
        demoHash,
        demo.departmentId,
        demo.roleId,
        `${demo.username}@virtgate.local`,
        now,
      );
    }

    const clusterExists = db.prepare('SELECT id FROM clusters WHERE id = ?').get('cluster-demo') as { id: string } | undefined;
    if (!clusterExists) {
      runSql(
        db,
        `INSERT INTO clusters (id, name, provider, api_url, token_id, token_secret_enc, verify_tls, status, version, node_count, enabled, created_at, updated_at)
         VALUES (?, ?, 'mock', ?, '', '', 1, 'online', '8.2.4 (mock)', 2, 1, ?, ?)`,
        'cluster-demo',
        '演示集群 · Mock',
        'mock://demo-cluster',
        now,
        now,
      );
    }
  }

  for (const quota of QUOTA_SEEDS) {
    const existing = db
      .prepare("SELECT id FROM quota_policies WHERE scope_type = 'department' AND scope_id = ?")
      .get(quota.scopeId) as { id: string } | undefined;
    if (existing) continue;
    runSql(
      db,
      `INSERT INTO quota_policies (id, scope_type, scope_id, cpu_cores, memory_mb, storage_gb, network_mbps, guest_limit, updated_at)
       VALUES (?, 'department', ?, ?, ?, ?, ?, ?, ?)`,
      `quota-${quota.scopeId}`,
      quota.scopeId,
      quota.cpu,
      quota.memory,
      quota.storage,
      quota.network,
      quota.guests,
      now,
    );
  }

  if (options.demoMode) {
    const bobQuota = db
      .prepare("SELECT id FROM quota_policies WHERE scope_type = 'user' AND scope_id = ?")
      .get('user-bob') as { id: string } | undefined;
    if (!bobQuota) {
      runSql(
        db,
        `INSERT INTO quota_policies (id, scope_type, scope_id, cpu_cores, memory_mb, storage_gb, network_mbps, guest_limit, updated_at)
         VALUES (?, 'user', ?, 24, 49152, 600, 600, 8, ?)`,
        'quota-user-bob',
        'user-bob',
        now,
      );
    }
  }
}

export function seedSummary(db: Db): { users: number; departments: number; roles: number; clusters: number } {
  const count = (table: string): number =>
    Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
  return {
    users: count('users'),
    departments: count('departments'),
    roles: count('roles'),
    clusters: count('clusters'),
  };
}

export function listDemoUsernames(db: Db): string[] {
  return allRows<{ username: string }>(db, 'SELECT username FROM users ORDER BY created_at ASC').map((row) => row.username);
}
