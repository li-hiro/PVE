import { ZodError, type ZodType } from 'zod';
import type { FastifyRequest } from 'fastify';
import { badRequest } from './errors.js';
import type { RequestContext } from '../services/operation-pipeline.js';
import type { UserRecord } from '../domain.js';

export function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw badRequest(
      '参数校验失败',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

export interface PageQuery {
  page: number;
  pageSize: number;
}

export function pageParams(query: unknown): PageQuery {
  const record = (query ?? {}) as Record<string, unknown>;
  const page = Number.parseInt(String(record.page ?? '1'), 10);
  const pageSize = Number.parseInt(String(record.pageSize ?? '20'), 10);
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 200) : 20,
  };
}

export const isZodError = (error: unknown): error is ZodError => error instanceof ZodError;

export function requestContext(req: FastifyRequest): RequestContext {
  return {
    actor: req.authUser,
    ip: req.ip,
    userAgent: String(req.headers['user-agent'] ?? ''),
    requestId: req.id,
  };
}

export function publicUser(user: UserRecord): Record<string, unknown> {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    departmentId: user.departmentId,
    departmentName: user.departmentName,
    roleId: user.roleId,
    roleName: user.roleName,
    roleScope: user.roleScope,
    permissions: user.permissions,
    status: user.status,
    email: user.email,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

export const dayRange = (days: number): { from: string; to: string } => {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
};
