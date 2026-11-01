import type { AppConfig } from './config.js';
import type { Db } from './db/index.js';
import type { AuditEventRecord, AuthUser } from './domain.js';
import { AuditLedger } from './modules/audit/audit-ledger.js';
import { ProviderRegistry } from './pve/provider-registry.js';
import { AlertService, type LoggerLike } from './services/alert-service.js';
import { AnomalyService } from './services/anomaly-service.js';
import { OperationPipeline, type RequestContext } from './services/operation-pipeline.js';
import { QuotaService } from './services/quota-service.js';
import { SyncWorker } from './services/sync-worker.js';

export interface AuditRecordInput {
  action: string;
  targetType: string;
  targetId: string;
  result: 'success' | 'failure' | 'denied';
  detail?: Record<string, unknown>;
}

export interface Services {
  db: Db;
  config: AppConfig;
  registry: ProviderRegistry;
  quotas: QuotaService;
  audit: AuditLedger;
  anomaly: AnomalyService;
  alerts: AlertService;
  pipeline: OperationPipeline;
  sync: SyncWorker;
  recordAudit: (ctx: RequestContext, input: AuditRecordInput) => AuditEventRecord;
}

export function createServices(db: Db, config: AppConfig, logger?: LoggerLike): Services {
  const registry = new ProviderRegistry(db, config);
  const alerts = new AlertService(db, config, logger);
  const audit = new AuditLedger(db);
  const anomaly = new AnomalyService(audit, alerts, config);
  const quotas = new QuotaService(db);
  const pipeline = new OperationPipeline({ db, config, registry, quotas, audit, anomaly, alerts });
  const sync = new SyncWorker({ db, config, registry, alerts, logger });

  const recordAudit = (ctx: RequestContext, input: AuditRecordInput): AuditEventRecord => {
    const event = audit.append({
      actorId: ctx.actor.id,
      actorName: ctx.actor.displayName,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      result: input.result,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      detail: input.detail ?? {},
    });
    anomaly.evaluate(event);
    return event;
  };

  return { db, config, registry, quotas, audit, anomaly, alerts, pipeline, sync, recordAudit };
}

export const actorFromUser = (user: AuthUser): AuthUser => user;
