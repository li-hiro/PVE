import type { FastifyInstance } from 'fastify';
import { badRequest } from '../lib/errors.js';
import { dayRange, pageParams } from '../lib/http.js';
import { actorScope, guestScope } from '../services/access.js';
import { listClusters } from '../modules/clusters/cluster-repo.js';
import { listGuests, guestStatusSummary } from '../modules/guests/guest-repo.js';
import { listOperations } from '../modules/operations/operation-repo.js';
import { latestNodeSnapshots, metricSeries } from '../modules/dashboard/metrics-repo.js';
import { getDepartment } from '../modules/departments/department-repo.js';

const RANGE_PRESETS: Record<string, { windowMs: number; bucketMs: number; label: string }> = {
  '1h': { windowMs: 3_600_000, bucketMs: 300_000, label: '近 1 小时' },
  '6h': { windowMs: 21_600_000, bucketMs: 900_000, label: '近 6 小时' },
  '24h': { windowMs: 86_400_000, bucketMs: 1_800_000, label: '近 24 小时' },
  '7d': { windowMs: 604_800_000, bucketMs: 10_800_000, label: '近 7 天' },
};

/**
 * 监控面板路由：聚合集群、节点、资源、告警、审计与配额数据，
 * 单次请求即可渲染首页，避免前端瀑布式请求。
 */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/dashboard/overview', { preHandler: app.requirePermission('dashboard.read') }, async (request) => {
    const actor = request.authUser;
    const { db, alerts, audit, quotas, config } = app.services;
    const scope = guestScope(actor);

    const scopedGuests = listGuests(db, {
      scopeSql: scope?.sql,
      scopeParams: scope?.params,
      page: 1,
      pageSize: 2000,
    });
    const guestStats = scope
      ? {
          total: scopedGuests.items.length,
          running: scopedGuests.items.filter((guest) => !guest.template && guest.status === 'running').length,
          stopped: scopedGuests.items.filter((guest) => !guest.template && guest.status === 'stopped').length,
          templates: scopedGuests.items.filter((guest) => guest.template).length,
        }
      : guestStatusSummary(db);

    const clusters = listClusters(db);
    const nodeSnapshots = latestNodeSnapshots(db);
    const preset = RANGE_PRESETS['24h']!;
    const series = metricSeries(db, {
      sinceEpoch: Date.now() - preset.windowMs,
      bucketMs: preset.bucketMs,
    });

    const alertSummary = alerts.summary();
    const recentAlerts = alerts.recent(6);
    const anomalyAlerts = alerts.list({ category: 'anomaly', page: 1, pageSize: 5 }).items;
    const recentOperations = listOperations(db, {
      scopeSql: scope?.sql,
      scopeParams: scope?.params,
      page: 1,
      pageSize: 8,
    }).items;
    const auditScope = actorScope(actor);
    const auditStats = audit.stats({
      ...dayRange(1),
      scopeSql: auditScope?.sql,
      scopeParams: auditScope?.params,
    });
    const recentEvents = audit
      .list({
        scopeSql: auditScope?.sql,
        scopeParams: auditScope?.params,
        page: 1,
        pageSize: 8,
      })
      .items;

    const quotaSnapshots = [];
    if (actor.permissions.includes('*') || actor.permissions.includes('quota.read')) {
      quotaSnapshots.push(quotas.snapshot('user', actor.id, actor.displayName));
      if (actor.departmentId) {
        const department = getDepartment(db, actor.departmentId);
        if (department) quotaSnapshots.push(quotas.snapshot('department', department.id, department.name));
      }
    }

    return {
      data: {
        generatedAt: new Date().toISOString(),
        demoMode: config.demoMode,
        clusters: clusters.map((cluster) => ({
          id: cluster.id,
          name: cluster.name,
          provider: cluster.provider,
          status: cluster.status,
          version: cluster.version,
          nodeCount: cluster.nodeCount,
          enabled: cluster.enabled,
          lastSyncAt: cluster.lastSyncAt,
          lastError: cluster.lastError,
        })),
        guests: guestStats,
        nodes: nodeSnapshots,
        metrics: {
          range: '24h',
          label: preset.label,
          bucketMs: preset.bucketMs,
          points: series,
        },
        alerts: {
          summary: alertSummary,
          recent: recentAlerts,
          anomaly: anomalyAlerts,
        },
        operations: recentOperations,
        audit: {
          summary: auditStats,
          recent: recentEvents,
        },
        quotas: quotaSnapshots,
      },
    };
  });

  app.get('/api/v1/dashboard/metrics', { preHandler: app.requirePermission('dashboard.read') }, async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const preset = RANGE_PRESETS[query.range ?? '24h'];
    if (!preset) throw badRequest('range 仅支持 1h、6h、24h、7d');
    return {
      data: {
        range: query.range ?? '24h',
        label: preset.label,
        bucketMs: preset.bucketMs,
        points: metricSeries(app.services.db, {
          clusterId: query.clusterId,
          sinceEpoch: Date.now() - preset.windowMs,
          bucketMs: preset.bucketMs,
        }),
      },
    };
  });

  app.get('/api/v1/dashboard/operations', { preHandler: app.requirePermission('operation.read') }, async (request) => {
    const { page, pageSize } = pageParams(request.query);
    const scope = guestScope(request.authUser);
    const result = listOperations(app.services.db, {
      scopeSql: scope?.sql,
      scopeParams: scope?.params,
      page,
      pageSize,
    });
    return { data: result.items, meta: { page, pageSize, total: result.total } };
  });
}
