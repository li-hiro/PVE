import type { Db } from '../db/index.js';
import type { AuthUser, GuestRecord } from '../domain.js';

export interface ScopeClause {
  sql: string;
  params: (string | number)[];
}

/**
 * 数据行级权限：角色作用域决定可见范围。
 * global 全量；department 按所属部门；own 仅本人创建的资源。
 */
export function guestScope(user: AuthUser): ScopeClause | null {
  if (user.roleScope === 'global') return null;
  if (user.roleScope === 'department') {
    return { sql: 'g.department_id = ?', params: [user.departmentId ?? ''] };
  }
  return { sql: 'g.owner_id = ?', params: [user.id] };
}

export function guestScopeBare(user: AuthUser): ScopeClause | null {
  if (user.roleScope === 'global') return null;
  if (user.roleScope === 'department') {
    return { sql: 'department_id = ?', params: [user.departmentId ?? ''] };
  }
  return { sql: 'owner_id = ?', params: [user.id] };
}

export function actorScope(user: AuthUser): ScopeClause | null {
  if (user.roleScope === 'global') return null;
  if (user.roleScope === 'department') {
    return {
      sql: '(actor_id = ? OR actor_id IN (SELECT id FROM users WHERE department_id = ?))',
      params: [user.id, user.departmentId ?? ''],
    };
  }
  return { sql: 'actor_id = ?', params: [user.id] };
}

export function assertGuestAccess(user: AuthUser, guest: GuestRecord): void {
  if (user.roleScope === 'global') return;
  if (user.roleScope === 'department') {
    if (guest.departmentId === user.departmentId) return;
    throw new Error('SCOPE_DENIED');
  }
  if (guest.ownerId === user.id) return;
  throw new Error('SCOPE_DENIED');
}

export const canAccessGuest = (user: AuthUser, guest: GuestRecord): boolean => {
  if (user.roleScope === 'global') return true;
  if (user.roleScope === 'department') return guest.departmentId === user.departmentId;
  return guest.ownerId === user.id;
};

export function visibleDepartmentId(user: AuthUser, requested?: string): string | null {
  if (user.roleScope === 'global') return requested ?? null;
  return user.departmentId;
}

export const canManageUser = (actor: AuthUser, targetDepartmentId: string | null): boolean => {
  if (actor.roleScope === 'global') return true;
  return actor.departmentId !== null && actor.departmentId === targetDepartmentId;
};

export function quotaScopesFor(user: AuthUser): Array<{ scopeType: 'department' | 'user'; scopeId: string }> {
  if (user.roleScope === 'global') return [];
  const scopes: Array<{ scopeType: 'department' | 'user'; scopeId: string }> = [];
  if (user.departmentId) scopes.push({ scopeType: 'department', scopeId: user.departmentId });
  scopes.push({ scopeType: 'user', scopeId: user.id });
  return scopes;
}

export const dbExists = (db: Db, table: string, id: string): boolean => {
  const row = db.prepare(`SELECT 1 AS ok FROM ${table} WHERE id = ?`).get(id);
  return Boolean(row);
};
