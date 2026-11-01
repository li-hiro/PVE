import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { parseInput, requestContext } from '../lib/http.js';
import type { AuthUser } from '../domain.js';
import { getDepartment, listDepartments } from '../modules/departments/department-repo.js';
import {
  deleteQuotaPolicy,
  getQuotaPolicy,
  listQuotaPolicies,
  upsertQuotaPolicy,
} from '../modules/quotas/quota-repo.js';
import { findUserById } from '../modules/users/user-repo.js';

const limitSchema = z.number().int().min(0).max(10_000_000).nullable();

const quotaSchema = z.object({
  scopeType: z.enum(['department', 'user']),
  scopeId: z.string().min(1),
  cpuCores: limitSchema.optional(),
  memoryMb: limitSchema.optional(),
  storageGb: limitSchema.optional(),
  networkMbps: limitSchema.optional(),
  guestLimit: limitSchema.optional(),
});

function resolveScopeName(
  app: FastifyInstance,
  scopeType: 'department' | 'user',
  scopeId: string,
): string {
  if (scopeType === 'department') {
    const department = getDepartment(app.services.db, scopeId);
    if (!department) throw notFound('部门不存在');
    return department.name;
  }
  const user = findUserById(app.services.db, scopeId);
  if (!user) throw notFound('用户不存在');
  return user.displayName;
}

function assertCanManage(
  app: FastifyInstance,
  actor: AuthUser,
  scopeType: 'department' | 'user',
  scopeId: string,
): void {
  resolveScopeName(app, scopeType, scopeId);
  if (actor.roleScope === 'global') return;
  if (scopeType === 'department') {
    if (scopeId !== actor.departmentId) throw forbidden('只能管理本部门配额');
    return;
  }
  const target = findUserById(app.services.db, scopeId);
  if (!target || target.departmentId !== actor.departmentId) {
    throw forbidden('只能管理本部门用户配额');
  }
}

/**
 * 配额路由：读取统一返回“限额 + 实际用量 + 预占用量”的快照，
 * 写入时按作用域校验，确保部门管理员无法调整其他部门的上限。
 */
export async function quotaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/quotas', { preHandler: app.requirePermission('quota.read') }, async (request) => {
    const actor = request.authUser;
    const { quotas, db } = app.services;
    if (actor.roleScope === 'global') {
      const departments = listDepartments(db).map((department) =>
        quotas.snapshot('department', department.id, department.name),
      );
      const userPolicies = listQuotaPolicies(db)
        .filter((policy) => policy.scopeType === 'user')
        .map((policy) => quotas.snapshot('user', policy.scopeId, policy.scopeName));
      return { data: [...departments, ...userPolicies] };
    }

    const result = [];
    if (actor.departmentId) {
      const department = getDepartment(db, actor.departmentId);
      if (department) result.push(quotas.snapshot('department', department.id, department.name));
    }
    result.push(quotas.snapshot('user', actor.id, actor.displayName));
    return { data: result };
  });

  app.get('/api/v1/quotas/me', { preHandler: app.authenticate }, async (request) => {
    const actor = request.authUser;
    return {
      data: app.services.quotas.snapshot('user', actor.id, actor.displayName),
    };
  });

  app.get('/api/v1/quotas/effective', { preHandler: app.requirePermission('quota.read') }, async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const scopeType = query.scopeType === 'department' ? 'department' : 'user';
    const scopeId = query.scopeId ?? request.authUser.id;
    if (request.authUser.roleScope !== 'global') {
      if (scopeType === 'department' && scopeId !== request.authUser.departmentId) {
        throw forbidden('只能查看本部门配额');
      }
      if (scopeType === 'user' && scopeId !== request.authUser.id) {
        const target = findUserById(app.services.db, scopeId);
        if (!target || target.departmentId !== request.authUser.departmentId) {
          throw forbidden('只能查看本部门用户配额');
        }
      }
    }
    return {
      data: app.services.quotas.snapshot(
        scopeType,
        scopeId,
        resolveScopeName(app, scopeType, scopeId),
      ),
    };
  });

  app.put('/api/v1/quotas', { preHandler: app.requirePermission('quota.manage') }, async (request) => {
    const body = parseInput(quotaSchema, request.body);
    assertCanManage(app, request.authUser, body.scopeType, body.scopeId);
    const before = getQuotaPolicy(app.services.db, body.scopeType, body.scopeId);
    upsertQuotaPolicy(app.services.db, {
      scopeType: body.scopeType,
      scopeId: body.scopeId,
      cpuCores: body.cpuCores === undefined ? (before?.cpuCores ?? null) : body.cpuCores,
      memoryMb: body.memoryMb === undefined ? (before?.memoryMb ?? null) : body.memoryMb,
      storageGb: body.storageGb === undefined ? (before?.storageGb ?? null) : body.storageGb,
      networkMbps: body.networkMbps === undefined ? (before?.networkMbps ?? null) : body.networkMbps,
      guestLimit: body.guestLimit === undefined ? (before?.guestLimit ?? null) : body.guestLimit,
    });
    const after = getQuotaPolicy(app.services.db, body.scopeType, body.scopeId);
    if (body.scopeType === 'department' || body.scopeType === 'user') {
      // 限额变更必须留痕，便于审计追溯“谁放宽了配额”
      app.services.recordAudit(requestContext(request), {
        action: 'quota.update',
        targetType: 'quota',
        targetId: `${body.scopeType}:${body.scopeId}`,
        result: 'success',
        detail: { before, after },
      });
    }
    return {
      data: app.services.quotas.snapshot(
        body.scopeType,
        body.scopeId,
        resolveScopeName(app, body.scopeType, body.scopeId),
      ),
    };
  });

  app.delete(
    '/api/v1/quotas/:scopeType/:scopeId',
    { preHandler: app.requirePermission('quota.manage') },
    async (request) => {
      const { scopeType, scopeId } = request.params as { scopeType: string; scopeId: string };
      if (scopeType !== 'department' && scopeType !== 'user') throw badRequest('配额作用域不合法');
      assertCanManage(app, request.authUser, scopeType, scopeId);
      const before = getQuotaPolicy(app.services.db, scopeType, scopeId);
      if (!before) throw notFound('该作用域尚未配置配额');
      deleteQuotaPolicy(app.services.db, scopeType, scopeId);
      app.services.recordAudit(requestContext(request), {
        action: 'quota.delete',
        targetType: 'quota',
        targetId: `${scopeType}:${scopeId}`,
        result: 'success',
        detail: { before },
      });
      return { data: { ok: true } };
    },
  );
}
