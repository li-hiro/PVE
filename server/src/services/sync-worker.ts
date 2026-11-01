import type { AppConfig } from '../config.js';
import type { Db } from '../db/index.js';
import type { ClusterRecord } from '../domain.js';
import { listClusters, updateClusterHealth } from '../modules/clusters/cluster-repo.js';
import {
  assignGuestOwner,
  deleteGuestRow,
  findGuestByVm,
  listGuests,
  upsertSyncedGuest,
} from '../modules/guests/guest-repo.js';
import { hasRecentOperation } from '../modules/operations/operation-repo.js';
import { insertMetricsSample, pruneMetrics } from '../modules/dashboard/metrics-repo.js';
import { findUserByUsername } from '../modules/users/user-repo.js';
import type { ProviderRegistry } from '../pve/provider-registry.js';
import type { ClusterProvider, ProviderGuestInfo } from '../pve/types.js';
import type { AlertService, LoggerLike } from './alert-service.js';

export interface SyncClusterReport {
  clusterId: string;
  name: string;
  status: 'ok' | 'error';
  nodes: number;
  guests: number;
  unexpectedStops: number;
  durationMs: number;
  error: string | null;
  syncedAt: string | null;
}

export interface SyncDeps {
  db: Db;
  config: AppConfig;
  registry: ProviderRegistry;
  alerts: AlertService;
  logger?: LoggerLike;
}

/**
 * 同步工作者：以固定周期拉取集群真实状态，维护本地资源缓存、指标样本与可用性告警。
 * 不依赖 PVE 推送通道，适合中小企业网络环境中的单向访问场景。
 */
export class SyncWorker {
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: SyncDeps) {}

  start(): void {
    if (!this.deps.config.syncEnabled || this.timer) return;
    this.initialTimer = setTimeout(() => {
      void this.syncAll();
    }, 500);
    this.timer = setInterval(() => {
      void this.syncAll();
    }, this.deps.config.syncIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.timer = null;
    this.initialTimer = null;
  }

  async syncAll(): Promise<SyncClusterReport[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const clusters = listClusters(this.deps.db).filter((cluster) => cluster.enabled);
      const reports: SyncClusterReport[] = [];
      for (const cluster of clusters) {
        reports.push(await this.syncCluster(cluster));
      }
      return reports;
    } finally {
      this.running = false;
    }
  }

  async syncCluster(cluster: ClusterRecord): Promise<SyncClusterReport> {
    const startedAt = Date.now();
    const syncedAt = new Date().toISOString();
    let provider: ClusterProvider;
    try {
      provider = this.deps.registry.forCluster(cluster);
      const nodes = await provider.listNodes();
      const snapshot = await provider.listGuests();
      const unexpectedStops = this.upsertGuests(cluster, snapshot);
      const metrics = await provider.metrics(nodes, snapshot);
      for (const point of metrics) {
        insertMetricsSample(this.deps.db, {
          clusterId: cluster.id,
          node: point.node,
          cpuPct: point.cpuPct,
          memPct: point.memPct,
          diskPct: point.diskPct,
          guestsRunning: point.guestsRunning,
          guestsTotal: point.guestsTotal,
          capturedAt: Date.now(),
        });
      }
      this.deps.alerts.evaluateNodes(cluster.id, nodes);
      const retentionCutoff = Date.now() - this.deps.config.metricsRetentionDays * 86_400_000;
      pruneMetrics(this.deps.db, retentionCutoff);
      updateClusterHealth(this.deps.db, cluster.id, {
        status: 'online',
        nodeCount: nodes.length,
        lastError: null,
        lastSyncAt: syncedAt,
      });
      return {
        clusterId: cluster.id,
        name: cluster.name,
        status: 'ok',
        nodes: nodes.length,
        guests: snapshot.length,
        unexpectedStops,
        durationMs: Date.now() - startedAt,
        error: null,
        syncedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateClusterHealth(this.deps.db, cluster.id, {
        status: 'offline',
        lastError: message,
        lastSyncAt: syncedAt,
      });
      this.deps.alerts.alertClusterOffline(cluster.id, cluster.name, message);
      this.deps.logger?.warn({ clusterId: cluster.id, error: message }, '集群同步失败');
      return {
        clusterId: cluster.id,
        name: cluster.name,
        status: 'error',
        nodes: 0,
        guests: 0,
        unexpectedStops: 0,
        durationMs: Date.now() - startedAt,
        error: message,
        syncedAt,
      };
    }
  }

  private upsertGuests(cluster: ClusterRecord, snapshot: ProviderGuestInfo[]): number {
    const { db } = this.deps;
    let unexpectedStops = 0;
    const seenVmids = new Set<number>();
    const since = new Date(Date.now() - 10 * 60_000).toISOString();

    for (const guest of snapshot) {
      if (guest.vmid <= 0) continue;
      seenVmids.add(guest.vmid);
      const existing = findGuestByVm(db, cluster.id, guest.vmid);
      const guestId = existing?.id ?? `${cluster.id}-${guest.vmid}`;

      if (
        existing &&
        existing.status === 'running' &&
        guest.status === 'stopped' &&
        !hasRecentOperation(db, {
          clusterId: cluster.id,
          vmid: guest.vmid,
          actions: ['guest.power.stop', 'guest.power.shutdown'],
          sinceIso: since,
        })
      ) {
        unexpectedStops += 1;
        this.deps.alerts.alertGuestUnexpectedStop(cluster.id, guest.vmid, guest.name, guest.node);
      }

      upsertSyncedGuest(db, {
        id: guestId,
        clusterId: cluster.id,
        vmid: guest.vmid,
        type: guest.type,
        name: guest.name,
        node: guest.node,
        status: guest.status,
        cores: guest.cores,
        memoryMb: guest.memoryMb,
        diskGb: guest.diskGb,
        template: guest.template,
        tags: guest.tags,
        uptimeSec: guest.uptimeSec,
      });

      if (!existing && guest.ownerUsername) {
        const owner = findUserByUsername(db, guest.ownerUsername);
        if (owner) assignGuestOwner(db, guestId, owner.id, owner.departmentId);
      }
    }

    // 清理 15 分钟前就已存在、但集群侧已不存在的资源，避免配额统计长期虚高
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60_000).toISOString();
    const cached = listGuests(db, { clusterId: cluster.id, page: 1, pageSize: 2000 });
    for (const item of cached.items) {
      if (seenVmids.has(item.vmid)) continue;
      if (item.updatedAt < fifteenMinutesAgo) {
        deleteGuestRow(db, item.id);
      }
    }
    return unexpectedStops;
  }
}
