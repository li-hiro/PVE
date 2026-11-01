import { shortId } from '../lib/digest.js';
import type { AppConfig } from '../config.js';
import type { AuditEventRecord } from '../domain.js';
import type { AlertService } from './alert-service.js';
import type { AuditLedger } from '../modules/audit/audit-ledger.js';

export const DESTRUCTIVE_ACTIONS = [
  'guest.delete',
  'guest.power.stop',
  'guest.power.shutdown',
  'guest.power.reset',
  'guest.config.update',
  'template.mark',
  'quota.update',
  'quota.delete',
  'user.delete',
  'user.update',
  'role.update',
  'role.delete',
  'cluster.delete',
];

const MUTATION_PREFIXES = ['guest.', 'template.', 'quota.', 'user.', 'role.', 'department.', 'cluster.', 'auth.password'];

const isMutation = (action: string): boolean =>
  MUTATION_PREFIXES.some((prefix) => action.startsWith(prefix)) &&
  !['guest.read', 'audit.read', 'audit.export', 'audit.verify'].includes(action);

/**
 * 异常行为检测引擎：基于滑动时间窗的轻量规则，不依赖外部流处理组件。
 * 每次写入审计事件后即时评估，超过阈值即降级为告警。
 */
export class AnomalyService {
  constructor(
    private readonly ledger: AuditLedger,
    private readonly alerts: AlertService,
    private readonly config: AppConfig,
  ) {}

  evaluate(event: AuditEventRecord): void {
    const anomaly = this.config.anomaly;
    const windowStart = new Date(Date.now() - anomaly.windowMinutes * 60_000).toISOString();
    const actorId = event.actorId;
    const actorName = event.actorName;

    if (event.result === 'denied' && actorId) {
      const denied = this.ledger.countRecent({ actorId, result: 'denied', from: windowStart });
      if (denied >= anomaly.denialBurst) {
        this.alerts.create(
          {
            category: 'anomaly',
            rule: 'permission_denial_burst',
            severity: 'warning',
            title: `${actorName} 连续触发权限拒绝`,
            message: `${anomaly.windowMinutes} 分钟内累计 ${denied} 次被拒绝的敏感操作，可能存在越权尝试。`,
            targetType: 'user',
            targetId: actorId,
          },
          anomaly.windowMinutes,
        );
      }
    }

    if (event.result === 'failure' && actorId && event.action.startsWith('guest.')) {
      const failures = this.ledger.countRecent({
        actorId,
        result: 'failure',
        actions: [
          'guest.create',
          'guest.delete',
          'guest.config.update',
          'guest.power.start',
          'guest.power.stop',
          'guest.power.shutdown',
          'guest.power.reboot',
          'guest.power.reset',
        ],
        from: windowStart,
      });
      if (failures >= anomaly.failureBurst) {
        this.alerts.create(
          {
            category: 'anomaly',
            rule: 'operation_failure_burst',
            severity: 'warning',
            title: `${actorName} 持续出现操作失败`,
            message: `${anomaly.windowMinutes} 分钟内累计 ${failures} 次资源操作失败，请检查集群健康或操作权限。`,
            targetType: 'user',
            targetId: actorId,
          },
          anomaly.windowMinutes,
        );
      }
    }

    if (actorId && DESTRUCTIVE_ACTIONS.includes(event.action) && event.result === 'success') {
      const destructive = this.ledger.countRecent({
        actorId,
        actions: DESTRUCTIVE_ACTIONS,
        from: windowStart,
      });
      if (destructive >= anomaly.destructiveBurst) {
        this.alerts.create(
          {
            category: 'anomaly',
            rule: 'destructive_burst',
            severity: 'warning',
            title: `${actorName} 短时间内执行大量高风险操作`,
            message: `${anomaly.windowMinutes} 分钟内累计 ${destructive} 次删除/停机/配置变更类操作，请人工复核。`,
            targetType: 'user',
            targetId: actorId,
          },
          anomaly.windowMinutes,
        );
      }
    }

    if (event.action === 'auth.login' && event.result === 'failure') {
      const failures = this.ledger.countRecent({ actorName, actions: ['auth.login'], result: 'failure', from: windowStart });
      if (failures >= anomaly.loginFailureBurst) {
        this.alerts.create(
          {
            category: 'anomaly',
            rule: 'login_bruteforce',
            severity: 'critical',
            title: `账号 ${actorName} 疑似遭遇暴力破解`,
            message: `${anomaly.windowMinutes} 分钟内登录失败 ${failures} 次，来源 IP ${event.ip || '未知'}。`,
            targetType: 'username',
            targetId: actorName,
          },
          anomaly.windowMinutes,
        );
      }
    }

    if (event.result === 'success' && isMutation(event.action)) {
      const hour = new Date(event.ts).getHours();
      if (hour >= anomaly.afterHoursStart && hour < anomaly.afterHoursEnd) {
        this.alerts.create(
          {
            category: 'anomaly',
            rule: 'off_hours_activity',
            severity: 'info',
            title: `非工作时段敏感操作：${event.action}`,
            message: `${actorName} 于 ${event.ts} 执行 ${event.action}（目标 ${event.targetType}:${event.targetId}）。`,
            targetType: 'user',
            targetId: actorId ?? actorName,
          },
          120,
        );
      }
    }
  }

  correlationId(): string {
    return shortId('anomaly');
  }
}
