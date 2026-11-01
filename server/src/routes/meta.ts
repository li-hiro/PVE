import type { FastifyInstance } from 'fastify';
import { seedSummary } from '../db/seed.js';
import { countOpenAlerts } from '../modules/alerts/alert-repo.js';
import { countGuestsByCluster, guestStatusSummary } from '../modules/guests/guest-repo.js';
import { listClusters } from '../modules/clusters/cluster-repo.js';
import { PERMISSION_CATALOG } from '../modules/rbac/catalog.js';

const VERSION = '1.0.0';

/**
 * 元信息与健康检查：供部署探针、前端初始化与二次开发者读取能力清单。
 * 该组接口不要求登录，但只暴露非敏感聚合信息。
 */
export async function metaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => ({
    status: 'ok',
    version: VERSION,
    time: new Date().toISOString(),
  }));

  app.get('/api/v1/meta/bootstrap', async () => {
    const { config } = app.services;
    return {
      data: {
        name: 'VirtGate',
        version: VERSION,
        description: 'PVE 自助管理与审计门户',
        demoMode: config.demoMode,
        permissions: PERMISSION_CATALOG,
        serverTime: new Date().toISOString(),
        features: {
          console: true,
          multiCluster: true,
          auditChain: true,
          quotaReservation: true,
        },
      },
    };
  });

  app.get('/api/v1/meta/health', async () => {
    const { db, config } = app.services;
    const clusters = listClusters(db);
    return {
      data: {
        status: 'ok',
        version: VERSION,
        demoMode: config.demoMode,
        syncEnabled: config.syncEnabled,
        seed: seedSummary(db),
        clusters: clusters.map((cluster) => ({
          id: cluster.id,
          name: cluster.name,
          status: cluster.status,
          enabled: cluster.enabled,
          lastSyncAt: cluster.lastSyncAt,
          guests: countGuestsByCluster(db, cluster.id),
        })),
        guests: guestStatusSummary(db),
        openAlerts: countOpenAlerts(db).total,
      },
    };
  });
}
