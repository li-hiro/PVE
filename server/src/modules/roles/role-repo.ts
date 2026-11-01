import { allRows, oneRow, runSql, type Db } from '../../db/index.js';
import type { RoleScope } from '../rbac/catalog.js';
import type { RoleRecord } from '../../domain.js';

interface RoleRow {
  id: string;
  name: string;
  description: string;
  scope: RoleScope;
  permissions: string;
  builtin: number;
  created_at: string;
  user_count?: number;
}

const parsePermissions = (raw: string): string[] => {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

const mapRole = (row: RoleRow): RoleRecord => ({
  id: row.id,
  name: row.name,
  description: row.description,
  scope: row.scope,
  permissions: parsePermissions(row.permissions),
  builtin: row.builtin === 1,
  createdAt: row.created_at,
  userCount: row.user_count,
});

export function listRoles(db: Db): RoleRecord[] {
  const rows = allRows<RoleRow>(
    db,
    `SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count
     FROM roles r ORDER BY r.builtin DESC, r.created_at ASC`,
  );
  return rows.map(mapRole);
}

export const getRole = (db: Db, id: string): RoleRecord | null => {
  const row = oneRow<RoleRow>(
    db,
    `SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count FROM roles r WHERE r.id = ?`,
    id,
  );
  return row ? mapRole(row) : null;
};

export const getRoleByName = (db: Db, name: string): RoleRecord | null => {
  const row = oneRow<RoleRow>(
    db,
    `SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count FROM roles r WHERE r.name = ?`,
    name,
  );
  return row ? mapRole(row) : null;
};

export interface CreateRoleInput {
  id: string;
  name: string;
  description: string;
  scope: RoleScope;
  permissions: string[];
}

export function insertRole(db: Db, input: CreateRoleInput): void {
  runSql(
    db,
    `INSERT INTO roles (id, name, description, scope, permissions, builtin, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
    input.id,
    input.name,
    input.description,
    input.scope,
    JSON.stringify(input.permissions),
    new Date().toISOString(),
  );
}

export function updateRole(
  db: Db,
  id: string,
  patch: { name?: string; description?: string; scope?: RoleScope; permissions?: string[] },
): void {
  const columns: string[] = [];
  const params: (string | number)[] = [];
  if (patch.name !== undefined) {
    columns.push('name = ?');
    params.push(patch.name);
  }
  if (patch.description !== undefined) {
    columns.push('description = ?');
    params.push(patch.description);
  }
  if (patch.scope !== undefined) {
    columns.push('scope = ?');
    params.push(patch.scope);
  }
  if (patch.permissions !== undefined) {
    columns.push('permissions = ?');
    params.push(JSON.stringify(patch.permissions));
  }
  if (columns.length === 0) return;
  runSql(db, `UPDATE roles SET ${columns.join(', ')} WHERE id = ?`, ...params, id);
}

export const deleteRole = (db: Db, id: string): void => {
  runSql(db, 'DELETE FROM roles WHERE id = ?', id);
};

export const roleNameExists = (db: Db, name: string, excludeId?: string): boolean => {
  const row = excludeId
    ? oneRow<{ id: string }>(db, 'SELECT id FROM roles WHERE name = ? AND id <> ?', name, excludeId)
    : oneRow<{ id: string }>(db, 'SELECT id FROM roles WHERE name = ?', name);
  return Boolean(row);
};
