import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { dayRange, pageParams, parseInput, requestContext } from '../lib/http.js';
import { actorScope } from '../services/access.js';
import type { AuditEventRecord } from '../domain.js';
import { listOperations } from '../modules/operations/operation-repo.js';
import { findUserById } from '../modules/users/user-repo.js';

const verifySchema = z.object({
  fromSeq: z.number().int().min(1).optional(),
  toSeq: z.number().int().min(1).optional(),
});

const RESULT_VALUES = new Set(['success', 'failure', 'denied']);

function auditFilters(request: {
  authUser: Parameters<typeof actorScope>[0];
  query: unknown;
}): {
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  result?: string;
  query?: string;
  from?: string;
  to?: string;
  scopeSql?: string;
  scopeParams?: (string | number)[];
} {
  const query = (request.query ?? {}) as Record<string, string | undefined>;
  const scope = actorScope(request.authUser);
  const result = query.result && RESULT_VALUES.has(query.result) ? query.result : undefined;
  return {
    actorId: query.actorId,
    action: query.action,
    targetType: query.targetType,
    targetId: query.targetId,
    result,
    query: query.q,
    from: query.from,
    to: query.to,
    scopeSql: scope?.sql,
    scopeParams: scope?.params,
  };
}

const escapeCsv = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
};

const toCsv = (events: AuditEventRecord[]): string => {
  const header = [
    'seq',
    'ts',
    'actor',
    'action',
    'targetType',
    'targetId',
    'result',
    'ip',
    'requestId',
    'detail',
    'prevHash',
    'hash',
  ];
  const lines = [header.join(',')];
  for (const event of events) {
    lines.push(
      [
        event.seq,
        escapeCsv(event.ts),
        escapeCsv(event.actorName),
        escapeCsv(event.action),
        escapeCsv(event.targetType),
        escapeCsv(event.targetId),
        escapeCsv(event.result),
        escapeCsv(event.ip),
        escapeCsv(event.requestId),
        escapeCsv(event.detail),
        escapeCsv(event.prevHash),
        escapeCsv(event.hash),
      ].join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
};

/**
 * 审计门户路由：检索、轨迹回放、哈希链校验与合规报表导出。
 * 所有查询均叠加角色数据范围，部门管理员只能看到本部门成员产生的审计事件。
 */
export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/operations', { preHandler: app.requirePermission('operation.read') }, async (request) => {
    const { page, pageSize } = pageParams(request.query);
    const query = request.query as Record<string, string | undefined>;
    const scope = actorScope(request.authUser);
    const status =
      query.status === 'success' || query.status === 'failed' || query.status === 'denied' || query.status === 'pending'
        ? query.status
        : undefined;
    const result = listOperations(app.services.db, {
      clusterId: query.clusterId,
      actorId: query.actorId,
      vmid: query.vmid ? Number.parseInt(query.vmid, 10) : undefined,
      action: query.action,
      status,
      query: query.q,
      from: query.from,
      to: query.to,
      scopeSql: scope?.sql,
      scopeParams: scope?.params,
      page,
      pageSize,
    });
    return { data: result.items, meta: { page, pageSize, total: result.total } };
  });

  app.get('/api/v1/audit/events', { preHandler: app.requirePermission('audit.read') }, async (request) => {
    const { page, pageSize } = pageParams(request.query);
    const filters = auditFilters(request);
    const result = app.services.audit.list({ ...filters, page, pageSize });
    return { data: result.items, meta: { page, pageSize, total: result.total } };
  });

  app.get('/api/v1/audit/stats', { preHandler: app.requirePermission('audit.read') }, async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const days = Number.parseInt(query.days ?? '7', 10);
    const range =
      query.from || query.to
        ? { from: query.from, to: query.to }
        : dayRange(Number.isFinite(days) ? days : 7);
    const scope = actorScope(request.authUser);
    return {
      data: app.services.audit.stats({
        ...range,
        scopeSql: scope?.sql,
        scopeParams: scope?.params,
      }),
    };
  });

  app.get('/api/v1/audit/events/:id', { preHandler: app.requirePermission('audit.read') }, async (request) => {
    const { id } = request.params as { id: string };
    const event = app.services.audit.get(id);
    if (!event) throw notFound('审计事件不存在');
    const actor = request.authUser;
    if (actor.roleScope !== 'global') {
      const eventActor = event.actorId ? findUserById(app.services.db, event.actorId) : null;
      const own = actor.roleScope === 'own' && event.actorId === actor.id;
      const department =
        actor.roleScope === 'department' &&
        eventActor !== null &&
        eventActor.departmentId === actor.departmentId;
      if (!own && !department) throw forbidden('该审计事件不在你的授权范围内');
    }
    return { data: event };
  });

  app.get('/api/v1/audit/timeline', { preHandler: app.requirePermission('audit.read') }, async (request) => {
    const query = request.query as Record<string, string | undefined>;
    if (!query.targetType || !query.targetId) throw badRequest('必须同时提供 targetType 与 targetId');
    return {
      data: app.services.audit.timeline(query.targetType, query.targetId),
    };
  });

  app.get('/api/v1/audit/request/:requestId', { preHandler: app.requirePermission('audit.read') }, async (request) => {
    const { requestId } = request.params as { requestId: string };
    return { data: app.services.audit.findByRequestId(requestId) };
  });

  app.post('/api/v1/audit/verify', { preHandler: app.requirePermission('audit.verify') }, async (request) => {
    const body = parseInput(verifySchema, request.body ?? {});
    const report = app.services.audit.verify(body.fromSeq ?? 1, body.toSeq ?? Number.MAX_SAFE_INTEGER);
    app.services.recordAudit(requestContext(request), {
      action: 'audit.verify',
      targetType: 'audit',
      targetId: body.fromSeq ? `${body.fromSeq}-${body.toSeq ?? 'head'}` : 'full-chain',
      result: report.valid ? 'success' : 'failure',
      detail: { ...report },
    });
    return { data: report };
  });

  app.get('/api/v1/audit/export', { preHandler: app.requirePermission('audit.export') }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const format = query.format === 'json' ? 'json' : 'csv';
    const days = Number.parseInt(query.days ?? '30', 10);
    const range = query.from || query.to ? { from: query.from, to: query.to } : dayRange(Number.isFinite(days) ? days : 30);
    const filters = auditFilters(request);
    const events = app.services.audit.all({ ...filters, ...range });
    const verification = app.services.audit.verify(1, Number.MAX_SAFE_INTEGER);
    const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19);

    app.services.recordAudit(requestContext(request), {
      action: 'audit.export',
      targetType: 'audit',
      targetId: format,
      result: 'success',
      detail: { format, from: range.from, to: range.to, count: events.length, chainValid: verification.valid },
    });

    if (format === 'json') {
      return reply
        .type('application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="virtgate-audit-${stamp}.json"`)
        .send(
          JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              range,
              verification,
              events,
            },
            null,
            2,
          ),
        );
    }
    return reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="virtgate-audit-${stamp}.csv"`)
      .send(toCsv(events));
  });
}
