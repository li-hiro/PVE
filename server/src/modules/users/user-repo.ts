import { allRows, oneRow, runSql, type Db } from '../../db/index.js';
import type { RoleScope } from '../rbac/catalog.js';
import type { UserRecord } from '../../domain.js';

interface UserJoinRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  department_id: string | null;
  role_id: string;
  status: string;
  email: string;
  created_at: string;
  last_login_at: string | null;
  role_name: string;
  role_scope: RoleScope;
  role_permissions: string;
  department_name: string | null;
}

const USER_SELECT = `
  SELECT u.id, u.username, u.display_name, u.password_hash, u.department_id, u.role_id, u.status,
         u.email, u.created_at, u.last_login_at,
         r.name AS role_name, r.scope AS role_scope, r.permissions AS role_permissions,
         d.name AS department_name
  FROM users u
  JOIN roles r ON r.id = u.role_id
  LEFT JOIN departments d ON d.id = u.department_id
`;

const parsePermissions = (raw: string): string[] => {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

const mapUser = (row: UserJoinRow): UserRecord => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  departmentId: row.department_id,
  roleId: row.role_id,
  roleName: row.role_name,
  roleScope: row.role_scope,
  permissions: parsePermissions(row.role_permissions),
  status: row.status,
  passwordHash: row.password_hash,
  email: row.email,
  createdAt: row.created_at,
  lastLoginAt: row.last_login_at,
  departmentName: row.department_name,
});

export const findUserByUsername = (db: Db, username: string): UserRecord | null => {
  const row = oneRow<UserJoinRow>(db, `${USER_SELECT} WHERE u.username = ?`, username);
  return row ? mapUser(row) : null;
};

export const findUserById = (db: Db, id: string): UserRecord | null => {
  const row = oneRow<UserJoinRow>(db, `${USER_SELECT} WHERE u.id = ?`, id);
  return row ? mapUser(row) : null;
};

export interface ListUsersOptions {
  departmentId?: string | null;
  query?: string;
  roleId?: string;
  status?: string;
  page: number;
  pageSize: number;
}

export function listUsers(db: Db, options: ListUsersOptions): { items: UserRecord[]; total: number } {
  const where: string[] = ['1 = 1'];
  const params: (string | number)[] = [];
  if (options.departmentId) {
    where.push('u.department_id = ?');
    params.push(options.departmentId);
  }
  if (options.roleId) {
    where.push('u.role_id = ?');
    params.push(options.roleId);
  }
  if (options.status) {
    where.push('u.status = ?');
    params.push(options.status);
  }
  if (options.query) {
    where.push('(u.username LIKE ? OR u.display_name LIKE ?)');
    params.push(`%${options.query}%`, `%${options.query}%`);
  }
  const whereSql = where.join(' AND ');
  const total = Number(
    (oneRow<{ n: number }>(db, `SELECT COUNT(*) AS n FROM users u WHERE ${whereSql}`, ...params)?.n) ?? 0,
  );
  const rows = allRows<UserJoinRow>(
    db,
    `${USER_SELECT} WHERE ${whereSql} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    options.pageSize,
    (options.page - 1) * options.pageSize,
  );
  return { items: rows.map(mapUser), total };
}

export interface CreateUserInput {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  departmentId: string | null;
  roleId: string;
  email: string;
  status: string;
}

export function insertUser(db: Db, input: CreateUserInput): void {
  runSql(
    db,
    `INSERT INTO users (id, username, display_name, password_hash, department_id, role_id, status, email, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.username,
    input.displayName,
    input.passwordHash,
    input.departmentId,
    input.roleId,
    input.status,
    input.email,
    new Date().toISOString(),
  );
}

export interface UpdateUserPatch {
  displayName?: string;
  departmentId?: string | null;
  roleId?: string;
  status?: string;
  email?: string;
  passwordHash?: string;
}

export function updateUser(db: Db, id: string, patch: UpdateUserPatch): void {
  const columns: string[] = [];
  const params: (string | null)[] = [];
  const assign = (column: string, value: string | null | undefined): void => {
    if (value === undefined) return;
    columns.push(`${column} = ?`);
    params.push(value);
  };
  assign('display_name', patch.displayName);
  assign('department_id', patch.departmentId);
  assign('role_id', patch.roleId);
  assign('status', patch.status);
  assign('email', patch.email);
  assign('password_hash', patch.passwordHash);
  if (columns.length === 0) return;
  runSql(db, `UPDATE users SET ${columns.join(', ')} WHERE id = ?`, ...params, id);
}

export const deleteUser = (db: Db, id: string): void => {
  runSql(db, 'DELETE FROM users WHERE id = ?', id);
};

export const touchLastLogin = (db: Db, id: string): void => {
  runSql(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', new Date().toISOString(), id);
};

export const countUsersByDepartment = (db: Db, departmentId: string): number =>
  Number((oneRow<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM users WHERE department_id = ?', departmentId)?.n) ?? 0);

export const countUsersByRole = (db: Db, roleId: string): number =>
  Number((oneRow<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM users WHERE role_id = ?', roleId)?.n) ?? 0);

export const countPlatformAdmins = (db: Db): number => countUsersByRole(db, 'role-platform-admin');

export function findUserIdByUsername(db: Db, username: string): string | null {
  const row = oneRow<{ id: string }>(db, 'SELECT id FROM users WHERE username = ?', username);
  return row?.id ?? null;
}
