import { newId } from '../lib/digest.js';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/index.js';
import type { AlertRecord, AlertSeverity } from '../domain.js';
import {
  ackAlert,
  countOpenAlerts,
  getAlert,
  hasRecentAlert,
  insertAlert,
  listAlerts,
  listRecentAlerts,
  type ListAlertFilters,
} from '../modules/alerts/alert-repo.js';

export interface LoggerLike {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export interface AlertCreateInput {
  category: AlertRecord['category'];
  rule: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  targetType: string;
  targetId: string;
}

export class AlertService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly logger?: LoggerLike,
  ) {}

  /**
   * 创建告警并按规则+目标做时间窗去重，避免同一次抖动产生大量重复事件。
   */
  create(input: AlertCreateInput, dedupeMinutes = 15): AlertRecord | null {
    const since = new Date(Date.now() - dedupeMinutes * 60_000).toISOString();
    if (hasRecentAlert(this.db, input.rule, input.targetId, since)) return null;
    insertAlert(this.db, { id: newId(), ...input });
    const alert = this.db
      .prepare('SELECT * FROM alerts WHERE rule = ? AND target_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(input.rule, input.targetId) as
      | {
          id: string;
          category: AlertRecord['category'];
          rule: string;
          severity: AlertSeverity;
          title: string;
          message: string;
          target_type: string;
          target_id: string;
          status: AlertRecord['status'];
          created_at: string;
          acked_at: string | null;
          acked_by: string | null;
        }
      | undefined;
    const created: AlertRecord | null = alert
      ? {
          id: alert.id,
          category: alert.category,
          rule: alert.rule,
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          targetType: alert.target_type,
          targetId: alert.target_id,
          status: alert.status,
          createdAt: alert.created_at,
          ackedAt: alert.acked_at,
          ackedBy: alert.acked_by,
        }
      : null;
    if (created) this.notify(created);
    return created;
  }

  private notify(alert: AlertRecord): void {
    if (!this.config.webhookUrl) return;
    const payload = JSON.stringify({ event: 'alert.created', alert });
    void fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'VirtGate-Alert/1.0' },
      body: payload,
      signal: AbortSignal.timeout(this.config.webhookTimeoutMs),
    }).catch((error: unknown) => {
      this.logger?.warn(
        { rule: alert.rule, reason: error instanceof Error ? error.message : String(error) },
        '告警 Webhook 推送失败',
      );
    });
  }

  evaluateNodes(
    clusterId: string,
    nodes: Array<{ node: string; cpuPct: number; memPct: number; diskPct: number }>,
  ): void {
    const thresholds = this.config.thresholds;
    for (const node of nodes) {
      const targetId = `${clusterId}:${node.node}`;
      if (node.cpuPct >= thresholds.cpuPct) {
        this.create(
          {
            category: 'resource',
            rule: 'node.cpu.high',
            severity: node.cpuPct >= 97 ? 'critical' : 'warning',
            title: `节点 ${node.node} CPU 使用率过高`,
            message: `当前 CPU 使用率为 ${node.cpuPct}%，阈值 ${thresholds.cpuPct}%。`,
            targetType: 'node',
            targetId,
          },
          30,
        );
      }
      if (node.memPct >= thresholds.memPct) {
        this.create(
          {
            category: 'resource',
            rule: 'node.memory.high',
            severity: node.memPct >= 97 ? 'critical' : 'warning',
            title: `节点 ${node.node} 内存使用率过高`,
            message: `当前内存使用率为 ${node.memPct}%，阈值 ${thresholds.memPct}%。`,
            targetType: 'node',
            targetId,
          },
          30,
        );
      }
      if (node.diskPct >= thresholds.diskPct) {
        this.create(
          {
            category: 'resource',
            rule: 'node.disk.high',
            severity: node.diskPct >= 99 ? 'critical' : 'warning',
            title: `节点 ${node.node} 根分区使用率过高`,
            message: `当前根分区使用率为 ${node.diskPct}%，阈值 ${thresholds.diskPct}%。`,
            targetType: 'node',
            targetId,
          },
          60,
        );
      }
    }
  }

  alertGuestUnexpectedStop(clusterId: string, vmid: number, guestName: string, node: string): void {
    this.create({
      category: 'availability',
      rule: 'guest.unexpected_stop',
      severity: 'warning',
      title: `资源 ${guestName} 发生非预期停机`,
      message: `同步检测到 ${guestName}（节点 ${node}）由运行状态变为停止，且最近未记录停机操作，请核查。`,
      targetType: 'guest',
      targetId: `${clusterId}:${vmid}`,
    });
  }

  alertClusterOffline(clusterId: string, clusterName: string, reason: string): void {
    this.create(
      {
        category: 'availability',
        rule: 'cluster.offline',
        severity: 'critical',
        title: `集群 ${clusterName} 连接异常`,
        message: `集群同步失败：${reason}`,
        targetType: 'cluster',
        targetId: clusterId,
      },
      30,
    );
  }

  list(filters: Omit<ListAlertFilters, 'page' | 'pageSize'> & { page: number; pageSize: number }) {
    return listAlerts(this.db, filters);
  }

  acknowledge(id: string, actorId: string): { ok: boolean; alert: AlertRecord | null } {
    const alert = getAlert(this.db, id);
    if (!alert) return { ok: false, alert: null };
    return { ok: ackAlert(this.db, id, actorId), alert };
  }

  summary() {
    return countOpenAlerts(this.db);
  }

  recent(limit: number, excludeCategory?: AlertRecord['category']): AlertRecord[] {
    return listRecentAlerts(this.db, limit, excludeCategory);
  }
}
