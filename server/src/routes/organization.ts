import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { newId } from '../lib/digest.js';
import { pageParams, parseInput, publicUser, requestContext } from '../lib/http.js';
import { canManageUser } from '../services/access.js';
import type { AuthUser } from '../domain.js';
import {
  countPlatformAdmins,
  countUsersByRole,
  deleteUser,
  findUserById,
  findUserByUsername,
  insertUser,
  listUsers,
  updateUser,
} from '../modules/users/user-repo.js';
import {
  countDepartmentReferences,
  deleteDepartment,
  departmentNameExists,
  getDepartment,
  insertDepartment,
  listDepartments,
  updateDepartment,
} from '../modules/departments/department-repo.js';
import {
  deleteRole,
  getRole,
  insertRole,
  listRoles,
  roleNameExists,
  updateRole,
} from '../modules/roles/role-repo.js';
import { PERMISSION_CATALOG, isKnownPermission } from '../modules/rbac/catalog.js';

const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._-]{3,32}$/, '用户名仅支持字母、数字、点、下划线和短横线（3-32 位）'),
  displayName: z.string().trim().min(1).max(64),
  password: z.string().min(8, '密码至少 8 位').max(128),
  roleId: z.string().min(1),
  departmentId: z.string().min(1).nullable().optional(),
  email: z.string().email('邮箱格式不正确').max(128).optional().default(''),
  status: z.enum(['active', 'disabled']).optional().default('active'),
});

const updateUserSchema = z.object({
  displayName: z.string().trim().min(1).max(64).optional(),
  roleId: z.string().min(1).optional(),
  departmentId: z.string().min(1).nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  email: z.string().email('邮箱格式不正确').max(128).optional(),
});

const resetPasswordSchema = z.object({ newPassword: z.string().min(8, '密码至少 8 位').max(128) });

const roleSchema = z.object({
  name: z.string().trim().regex(/^[a-zA-Z0-9_-]{2,32}$/, '角色标识仅支持字母、数字、下划线和短横线'),
  description: z.string().trim().max(200).optional().default(''),
  scope: z.enum(['global', 'department', 'own']),
  permissions: z.array(z.string()).min(1, '至少选择一项权限'),
});

const departmentSchema = z.object({
  name: z.string().trim().min(2, '部门名称至少 2 个字符').max(64),
  description: z.string().trim().max(200).optional().default(''),
});

function assertManageScope(actor: AuthUser, targetDepartmentId: string | null): void {
  if (actor.roleScope === 'global') return;
  if (!canManageUser(actor, targetDepartmentId)) {
    throw forbidden('只能管理本部门的用户');
  }
}

export async function organizationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/users', { preHandler: app.requirePermission('user.read') }, async (request) => {
    const { page, pageSize } = pageParams(request.query);
    const query = request.query as Record<string, string | undefined>;
    const actor = request.authUser;
    const departmentId =
      actor.roleScope === 'global' ? query.departmentId : actor.departmentId ?? '__none__';
    const result = listUsers(app.services.db, {
      departmentId,
      roleId: query.roleId,
      status: query.status,
      query: query.q,
      page,
      pageSize,
    });
    return { data: result.items.map(publicUser), meta: { page, pageSize, total: result.total } };
  });

  app.get('/api/v1/users/candidates', { preHandler: app.requirePermission('user.read') }, async (request) => {
    const actor = request.authUser;
    const query = request.query as Record<string, string | undefined>;
    const result = listUsers(app.services.db, {
      departmentId: actor.roleScope === 'global' ? query.departmentId : actor.departmentId ?? '__none__',
      status: 'active',
      query: query.q,
      page: 1,
      pageSize: 100,
    });
    return {
      data: result.items.map((user) => ({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        departmentId: user.departmentId,
        departmentName: user.departmentName,
      })),
    };
  });

  app.post('/api/v1/users', { preHandler: app.requirePermission('user.manage') }, async (request, reply) => {
    const body = parseInput(createUserSchema, request.body);
    const actor = request.authUser;
    if (findUserByUsername(app.services.db, body.username)) throw conflict('用户名已被占用');
    const role = getRole(app.services.db, body.roleId);
    if (!role) throw badRequest('所选角色不存在');
    if (actor.roleScope !== 'global' && role.scope === 'global') {
      throw forbidden('部门管理员不能分配全局作用域角色');
    }
    const departmentId = body.departmentId ?? null;
    if (departmentId && !getDepartment(app.services.db, departmentId)) throw badRequest('所选部门不存在');
    if (actor.roleScope !== 'global' && departmentId !== actor.departmentId) {
      throw forbidden('只能在本部门创建用户');
    }
    const id = newId();
    insertUser(app.services.db, {
      id,
      username: body.username,
      displayName: body.displayName,
      passwordHash: bcrypt.hashSync(body.password, 10),
      departmentId,
      roleId: body.roleId,
      email: body.email,
      status: body.status,
    });
    const user = findUserById(app.services.db, id);
    if (!user) throw notFound('用户创建失败');
    app.services.recordAudit(requestContext(request), {
      action: 'user.create',
      targetType: 'user',
      targetId: id,
      result: 'success',
      detail: { username: user.username, role: role.name, departmentId },
    });
    reply.status(201);
    return { data: publicUser(user) };
  });

  app.patch('/api/v1/users/:id', { preHandler: app.requirePermission('user.manage') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = parseInput(updateUserSchema, request.body);
    const actor = request.authUser;
    const target = findUserById(app.services.db, id);
    if (!target) throw notFound('用户不存在');
    assertManageScope(actor, target.departmentId);
    if (body.departmentId !== undefined && body.departmentId !== null) {
      if (!getDepartment(app.services.db, body.departmentId)) throw badRequest('所选部门不存在');
      if (actor.roleScope !== 'global' && body.departmentId !== actor.departmentId) {
        throw forbidden('只能将用户归属到本部门');
      }
    }
    if (body.roleId) {
      const role = getRole(app.services.db, body.roleId);
      if (!role) throw badRequest('所选角色不存在');
      if (actor.roleScope !== 'global' && role.scope === 'global') {
        throw forbidden('部门管理员不能分配全局作用域角色');
      }
    }
    if (target.roleId === 'role-platform-admin' && countPlatformAdmins(app.services.db) === 1) {
      const removingAdmin =
        (body.roleId && body.roleId !== 'role-platform-admin') || (body.status && body.status !== 'active');
      if (removingAdmin) throw conflict('系统必须保留至少一个平台管理员');
    }
    if (target.id === actor.id && body.status === 'disabled') throw badRequest('不能停用自己的账号');
    updateUser(app.services.db, target.id, {
      displayName: body.displayName,
      roleId: body.roleId,
      departmentId: body.departmentId,
      status: body.status,
      email: body.email,
    });
    const updated = findUserById(app.services.db, id);
    app.services.recordAudit(requestContext(request), {
      action: 'user.update',
      targetType: 'user',
      targetId: id,
      result: 'success',
      detail: {
        before: { roleId: target.roleId, departmentId: target.departmentId, status: target.status },
        after: { roleId: updated?.roleId, departmentId: updated?.departmentId, status: updated?.status },
      },
    });
    return { data: updated ? publicUser(updated) : null };
  });

  app.post(
    '/api/v1/users/:id/reset-password',
    { preHandler: app.requirePermission('user.manage') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = parseInput(resetPasswordSchema, request.body);
      const target = findUserById(app.services.db, id);
      if (!target) throw notFound('用户不存在');
      assertManageScope(request.authUser, target.departmentId);
      updateUser(app.services.db, id, { passwordHash: bcrypt.hashSync(body.newPassword, 10) });
      app.services.recordAudit(requestContext(request), {
        action: 'user.password.reset',
        targetType: 'user',
        targetId: id,
        result: 'success',
        detail: { username: target.username },
      });
      return { data: { ok: true } };
    },
  );

  app.delete('/api/v1/users/:id', { preHandler: app.requirePermission('user.manage') }, async (request) => {
    const { id } = request.params as { id: string };
    const target = findUserById(app.services.db, id);
    if (!target) throw notFound('用户不存在');
    if (target.id === request.authUser.id) throw badRequest('不能删除当前登录账号');
    assertManageScope(request.authUser, target.departmentId);
    if (target.roleId === 'role-platform-admin' && countPlatformAdmins(app.services.db) === 1) {
      throw conflict('系统必须保留至少一个平台管理员');
    }
    deleteUser(app.services.db, id);
    app.services.recordAudit(requestContext(request), {
      action: 'user.delete',
      targetType: 'user',
      targetId: id,
      result: 'success',
      detail: { username: target.username, departmentId: target.departmentId },
    });
    return { data: { ok: true } };
  });

  app.get('/api/v1/roles', { preHandler: app.requirePermission('role.read') }, async () => ({
    data: listRoles(app.services.db),
  }));

  app.get('/api/v1/permissions', { preHandler: app.requirePermission('role.read') }, async () => ({
    data: PERMISSION_CATALOG,
  }));

  app.post('/api/v1/roles', { preHandler: app.requirePermission('role.manage') }, async (request, reply) => {
    const body = parseInput(roleSchema, request.body);
    if (roleNameExists(app.services.db, body.name)) throw conflict('角色标识已存在');
    const invalid = body.permissions.filter((permission) => !isKnownPermission(permission));
    if (invalid.length > 0) throw badRequest('存在未知权限项', { invalid });
    insertRole(app.services.db, {
      id: newId(),
      name: body.name,
      description: body.description,
      scope: body.scope,
      permissions: body.permissions,
    });
    const roles = listRoles(app.services.db);
    const created = roles.find((role) => role.name === body.name);
    app.services.recordAudit(requestContext(request), {
      action: 'role.create',
      targetType: 'role',
      targetId: created?.id ?? body.name,
      result: 'success',
      detail: { name: body.name, scope: body.scope, permissions: body.permissions },
    });
    reply.status(201);
    return { data: created ?? null };
  });

  app.patch('/api/v1/roles/:id', { preHandler: app.requirePermission('role.manage') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = parseInput(roleSchema.partial(), request.body);
    const role = getRole(app.services.db, id);
    if (!role) throw notFound('角色不存在');
    if (role.builtin) throw forbidden('内置角色不允许修改');
    if (body.name && roleNameExists(app.services.db, body.name, id)) throw conflict('角色标识已存在');
    if (body.permissions) {
      const invalid = body.permissions.filter((permission) => !isKnownPermission(permission));
      if (invalid.length > 0) throw badRequest('存在未知权限项', { invalid });
    }
    updateRole(app.services.db, id, body);
    app.services.recordAudit(requestContext(request), {
      action: 'role.update',
      targetType: 'role',
      targetId: id,
      result: 'success',
      detail: { before: role.permissions, after: body.permissions ?? role.permissions },
    });
    return { data: getRole(app.services.db, id) };
  });

  app.delete('/api/v1/roles/:id', { preHandler: app.requirePermission('role.manage') }, async (request) => {
    const { id } = request.params as { id: string };
    const role = getRole(app.services.db, id);
    if (!role) throw notFound('角色不存在');
    if (role.builtin) throw forbidden('内置角色不允许删除');
    if (countUsersByRole(app.services.db, id) > 0) throw conflict('仍有用户使用该角色，无法删除');
    deleteRole(app.services.db, id);
    app.services.recordAudit(requestContext(request), {
      action: 'role.delete',
      targetType: 'role',
      targetId: id,
      result: 'success',
      detail: { name: role.name },
    });
    return { data: { ok: true } };
  });

  app.get('/api/v1/departments', { preHandler: app.requirePermission('department.read') }, async () => ({
    data: listDepartments(app.services.db),
  }));

  app.post(
    '/api/v1/departments',
    { preHandler: app.requirePermission('department.manage') },
    async (request, reply) => {
      const body = parseInput(departmentSchema, request.body);
      if (departmentNameExists(app.services.db, body.name)) throw conflict('部门名称已存在');
      const id = newId();
      insertDepartment(app.services.db, id, body.name, body.description);
      app.services.recordAudit(requestContext(request), {
        action: 'department.create',
        targetType: 'department',
        targetId: id,
        result: 'success',
        detail: { name: body.name },
      });
      reply.status(201);
      return { data: getDepartment(app.services.db, id) };
    },
  );

  app.patch(
    '/api/v1/departments/:id',
    { preHandler: app.requirePermission('department.manage') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = parseInput(departmentSchema.partial(), request.body);
      const department = getDepartment(app.services.db, id);
      if (!department) throw notFound('部门不存在');
      if (body.name && departmentNameExists(app.services.db, body.name, id)) throw conflict('部门名称已存在');
      updateDepartment(app.services.db, id, body.name, body.description);
      app.services.recordAudit(requestContext(request), {
        action: 'department.update',
        targetType: 'department',
        targetId: id,
        result: 'success',
        detail: { name: body.name },
      });
      return { data: getDepartment(app.services.db, id) };
    },
  );

  app.delete(
    '/api/v1/departments/:id',
    { preHandler: app.requirePermission('department.manage') },
    async (request) => {
      const { id } = request.params as { id: string };
      const department = getDepartment(app.services.db, id);
      if (!department) throw notFound('部门不存在');
      const refs = countDepartmentReferences(app.services.db, id);
      if (refs.users > 0 || refs.guests > 0) {
        throw conflict('部门下仍有用户或资源，无法删除', refs);
      }
      deleteDepartment(app.services.db, id);
      app.services.recordAudit(requestContext(request), {
        action: 'department.delete',
        targetType: 'department',
        targetId: id,
        result: 'success',
        detail: { name: department.name },
      });
      return { data: { ok: true } };
    },
  );
}
