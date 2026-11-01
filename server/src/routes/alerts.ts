import type { FastifyInstance } from 'fastify';
import { notFound } from '../lib/errors.js';
import { pageParams, requestContext } from '../lib/http.js';
import type { AlertRecord } from '../domain.js';
import { getAlert } from '../modules/alerts/alert-repo.js';

const SEVERITIES = new Set(['info', 'warning', 'critical']);
const STATUSES = new Set(['open', 'ack', 'closed']);
const CATEGORIES = new Set(['anomaly', 'resource', 'availability', 'operation']);

/**
 * 告警路由：异常行为、资源阈值与可用性告警统一在同一列表展示，
 * 支持按严重级别、状态与类别筛选，确认操作写入审计链。
 */
export async function alertRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/alerts/summary', { preHandler: app.requirePermission('alert.read') }, async () => ({
    data: app.services.alerts.summary(),
  }));

  app.get('/api/v1/alerts', { preHandler: app.requirePermission('alert.read') }, async (request) => {
    const { page, pageSize } = pageParams(request.query);
    const query = request.query as Record<string, string | undefined>;
    const status = query.status && STATUSES.has(query.status) ? (query.status as AlertRecord['status']) : undefined;
    const severity =
      query.severity && SEVERITIES.has(query.severity) ? (query.severity as AlertRecord['severity']) : undefined;
    const category =
      query.category && CATEGORIES.has(query.category) ? (query.category as AlertRecord['category']) : undefined;
    const result = app.services.alerts.list({
      status,
      severity,
      category,
      query: query.q,
      page,
      pageSize,
    });
    return { data: result.items, meta: { page, pageSize, total: result.total } };
  });

  app.get('/api/v1/alerts/:id', { preHandler: app.requirePermission('alert.read') }, async (request) => {
    const { id } = request.params as { id: string };
    const alert = getAlert(app.services.db, id);
    if (!alert) throw notFound('告警不存在');
    return { data: alert };
  });

  app.post('/api/v1/alerts/:id/ack', { preHandler: app.requirePermission('alert.manage') }, async (request) => {
    const { id } = request.params as { id: string };
    const result = app.services.alerts.acknowledge(id, request.authUser.id);
    if (!result.alert) throw notFound('告警不存在');
    app.services.recordAudit(requestContext(request), {
      action: 'alert.ack',
      targetType: 'alert',
      targetId: id,
      result: result.ok ? 'success' : 'failure',
      detail: { rule: result.alert.rule, title: result.alert.title, alreadyAcked: !result.ok },
    });
    return { data: { ok: true, alert: result.alert } };
  });
}
