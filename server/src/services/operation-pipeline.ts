import { newId } from '../lib/digest.js';
import { encryptSecret } from '../lib/secret-box.js';
import { badRequest, conflict, forbidden, isAppError, notFound } from '../lib/errors.js';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/index.js';
import type {
  AuthUser,
  ConsoleSessionRecord,
  GuestRecord,
  GuestStatus,
  GuestType,
  OperationRecord,
  UserRecord,
} from '../domain.js';
import type { PowerAction } from '../pve/types.js';
import type { ProviderRegistry } from '../pve/provider-registry.js';
import { canAccessGuest } from './access.js';
import type { AuditLedger } from '../modules/audit/audit-ledger.js';
import { getCluster } from '../modules/clusters/cluster-repo.js';
import {
  deleteGuestRow,
  findGuestByVm,
  getGuestById,
  insertConsoleSession,
  insertCreatedGuest,
  setGuestTemplate,
  updateGuestRuntime,
  updateGuestSpec,
} from '../modules/guests/guest-repo.js';
import { finishOperation, getOperation, insertOperation } from '../modules/operations/operation-repo.js';
import { findUserById } from '../modules/users/user-repo.js';
import type { AnomalyService } from './anomaly-service.js';
import type { AlertService } from './alert-service.js';
import type { QuotaService } from './quota-service.js';

export interface RequestContext {
  actor: AuthUser;
  ip: string;
  userAgent: string;
  requestId: string;
}

export interface CreateGuestCommand {
  clusterId: string;
  type: GuestType;
  name: string;
  node: string;
  cores: number;
  memoryMb: number;
  diskGb: number;
  storage: string;
  templateId: number | null;
  templateNode: string | null;
  iso: string | null;
  networkBridge: string;
  rateMbps: number;
  startOnCreate: boolean;
  ownerId: string | null;
}

export interface UpdateConfigCommand {
  cores?: number;
  memoryMb?: number;
  name?: string;
}

export interface OrganizationDeps {
  db: Db;
  config: AppConfig;
  registry: ProviderRegistry;
  quotas: QuotaService;
  audit: AuditLedger;
  anomaly: AnomalyService;
  alerts: AlertService;
}

export const guestTargetId = (clusterId: string, vmid: number): string => `${clusterId}:${vmid}`;

/**
 * 操作管道：所有写操作统一经过
 * 权限/作用域校验 → 配额预占 → Provider 执行 → 本地状态提交 → 审计落链 → 异常检测。
 * 该顺序保证“拒绝也会留痕、失败会释放配额、成功才提交”。
 */
export class OperationPipeline {
  constructor(private readonly deps: OrganizationDeps) {}

  async createGuest(
    ctx: RequestContext,
    command: CreateGuestCommand,
  ): Promise<{ guest: GuestRecord; operation: OperationRecord }> {
    const { db, registry, quotas } = this.deps;
    const operationId = newId();
    const startedAt = Date.now();
    insertOperation(db, {
      id: operationId,
      requestId: ctx.requestId,
      actorId: ctx.actor.id,
      actorName: ctx.actor.displayName,
      clusterId: command.clusterId,
      vmid: null,
      guestName: command.name,
      action: 'guest.create',
      params: {
        type: command.type,
        node: command.node,
        cores: command.cores,
        memoryMb: command.memoryMb,
        diskGb: command.diskGb,
        templateId: command.templateId,
        networkBridge: command.networkBridge,
        rateMbps: command.rateMbps,
      },
      ip: ctx.ip,
    });

    let reservationId: string | null = null;
    let vmid: number | null = null;
    try {
      const cluster = getCluster(db, command.clusterId);
      if (!cluster) throw notFound('集群不存在');
      if (!cluster.enabled) throw conflict('集群已被停用，无法创建资源');

      const owner = this.resolveOwner(ctx.actor, command.ownerId);
      let templateNode = command.templateNode;
      if (command.templateId !== null) {
        const template = findGuestByVm(db, cluster.id, command.templateId);
        if (!template || !template.template) throw badRequest('所选模板不存在或已被取消模板标记');
        if (template.type !== command.type) throw badRequest('模板类型与请求的资源类型不一致');
        templateNode = template.node;
      }

      reservationId = quotas.reserve({
        scopeType: 'user',
        scopeId: owner.id,
        actorId: ctx.actor.id,
        clusterId: cluster.id,
        vmid: null,
        request: {
          cpuCores: command.cores,
          memoryMb: command.memoryMb,
          storageGb: command.diskGb,
          networkMbps: command.rateMbps,
          guestCount: 1,
        },
      });

      const provider = registry.forCluster(cluster);
      const result = await provider.createGuest({
        type: command.type,
        name: command.name,
        node: command.node,
        cores: command.cores,
        memoryMb: command.memoryMb,
        diskGb: command.diskGb,
        storage: command.storage,
        templateId: command.templateId,
        templateNode,
        iso: command.iso,
        networkBridge: command.networkBridge,
        networkRateMbps: command.rateMbps,
        startOnCreate: command.startOnCreate,
      });
      vmid = result.vmid;
      const guestId = `${cluster.id}-${vmid}`;

      insertCreatedGuest(db, {
        id: guestId,
        clusterId: cluster.id,
        vmid,
        type: command.type,
        name: command.name,
        node: result.node,
        status: result.status,
        cores: command.cores,
        memoryMb: command.memoryMb,
        diskGb: command.diskGb,
        networkMbps: command.rateMbps,
        ownerId: owner.id,
        departmentId: owner.departmentId,
        tags: ['self-service'],
      });
      quotas.commit(reservationId);

      const durationMs = Date.now() - startedAt;
      finishOperation(db, operationId, { status: 'success', message: '资源创建成功', durationMs, vmid });
      this.recordAudit(ctx, {
        action: 'guest.create',
        targetType: 'guest',
        targetId: guestTargetId(cluster.id, vmid),
        result: 'success',
        detail: {
          operationId,
          vmid,
          clusterId: cluster.id,
          owner: owner.username,
          cores: command.cores,
          memoryMb: command.memoryMb,
          diskGb: command.diskGb,
          networkMbps: command.rateMbps,
          templateId: command.templateId,
          startOnCreate: command.startOnCreate,
        },
      });

      const guest = getGuestById(db, guestId);
      const operation = getOperation(db, operationId);
      if (!guest || !operation) throw new Error('创建后无法读取资源记录');
      return { guest, operation };
    } catch (error) {
      quotas.release(reservationId);
      const denied = isAppError(error) && error.code === 'QUOTA_EXCEEDED';
      finishOperation(db, operationId, {
        status: denied ? 'denied' : 'failed',
        message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
        vmid,
      });
      this.recordAudit(ctx, {
        action: 'guest.create',
        targetType: 'guest',
        targetId: vmid !== null ? guestTargetId(command.clusterId, vmid) : command.clusterId,
        result: denied ? 'denied' : 'failure',
        detail: {
          operationId,
          clusterId: command.clusterId,
          error: error instanceof Error ? error.message : String(error),
          errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
          requested: {
            cores: command.cores,
            memoryMb: command.memoryMb,
            diskGb: command.diskGb,
            networkMbps: command.rateMbps,
          },
          quotaDetails: isAppError(error) ? error.details : undefined,
        },
      });
      throw error;
    }
  }

  async power(
    ctx: RequestContext,
    guest: GuestRecord,
    action: PowerAction,
  ): Promise<{ guest: GuestRecord; operation: OperationRecord }> {
    if (guest.template) throw conflict('模板资源不支持电源操作');
    this.assertAccess(ctx.actor, guest);
    if (guest.type === 'lxc' && (action === 'reset' || action === 'suspend')) {
      throw badRequest('LXC 容器不支持该电源操作');
    }
    if (action === 'start' && guest.status === 'running') throw conflict('资源已在运行中');
    if (['stop', 'shutdown'].includes(action) && guest.status === 'stopped') {
      throw conflict('资源已处于停止状态');
    }
    if (['reboot', 'reset', 'suspend'].includes(action) && guest.status !== 'running') {
      throw conflict('仅运行中的资源支持该操作');
    }

    const { db, registry } = this.deps;
    const operationId = newId();
    const startedAt = Date.now();
    insertOperation(db, {
      id: operationId,
      requestId: ctx.requestId,
      actorId: ctx.actor.id,
      actorName: ctx.actor.displayName,
      clusterId: guest.clusterId,
      vmid: guest.vmid,
      guestName: guest.name,
      action: `guest.power.${action}`,
      params: { action, previousStatus: guest.status },
      ip: ctx.ip,
    });

    try {
      const cluster = getCluster(db, guest.clusterId);
      if (!cluster) throw notFound('集群不存在');
      const provider = registry.forCluster(cluster);
      const nextStatus = await provider.power(guest.vmid, guest.node, guest.type, action);
      this.applyRuntime(guest, nextStatus);
      const durationMs = Date.now() - startedAt;
      finishOperation(db, operationId, { status: 'success', message: '操作已下发并生效', durationMs });
      this.recordAudit(ctx, {
        action: `guest.power.${action}`,
        targetType: 'guest',
        targetId: guestTargetId(guest.clusterId, guest.vmid),
        result: 'success',
        detail: {
          operationId,
          vmid: guest.vmid,
          previousStatus: guest.status,
          nextStatus,
          node: guest.node,
        },
      });
      const updated = getGuestById(db, guest.id);
      const operation = getOperation(db, operationId);
      if (!updated || !operation) throw new Error('操作完成后无法读取记录');
      return { guest: updated, operation };
    } catch (error) {
      finishOperation(db, operationId, {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
      this.recordAudit(ctx, {
        action: `guest.power.${action}`,
        targetType: 'guest',
        targetId: guestTargetId(guest.clusterId, guest.vmid),
        result: 'failure',
        detail: {
          operationId,
          vmid: guest.vmid,
          error: error instanceof Error ? error.message : String(error),
          errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
        },
      });
      throw error;
    }
  }

  async updateConfig(
    ctx: RequestContext,
    guest: GuestRecord,
    patch: UpdateConfigCommand,
  ): Promise<{ guest: GuestRecord; operation: OperationRecord }> {
    if (guest.template) throw conflict('模板资源不支持调整配置');
    this.assertAccess(ctx.actor, guest);
    const nextCores = patch.cores ?? guest.cores;
    const nextMemory = patch.memoryMb ?? guest.memoryMb;
    const nextName = patch.name ?? guest.name;
    if (nextCores === guest.cores && nextMemory === guest.memoryMb && nextName === guest.name) {
      throw badRequest('配置未发生变化');
    }
    if (nextCores < 1 || nextMemory < 128) throw badRequest('CPU 至少 1 核、内存至少 128MB');

    const { db, registry, quotas } = this.deps;
    const operationId = newId();
    const startedAt = Date.now();
    insertOperation(db, {
      id: operationId,
      requestId: ctx.requestId,
      actorId: ctx.actor.id,
      actorName: ctx.actor.displayName,
      clusterId: guest.clusterId,
      vmid: guest.vmid,
      guestName: guest.name,
      action: 'guest.config.update',
      params: { cores: nextCores, memoryMb: nextMemory, name: nextName },
      ip: ctx.ip,
    });

    let reservationId: string | null = null;
    try {
      const cluster = getCluster(db, guest.clusterId);
      if (!cluster) throw notFound('集群不存在');
      const deltaCores = Math.max(0, nextCores - guest.cores);
      const deltaMemory = Math.max(0, nextMemory - guest.memoryMb);
      if (deltaCores > 0 || deltaMemory > 0) {
        reservationId = quotas.reserve({
          scopeType: 'user',
          scopeId: guest.ownerId ?? ctx.actor.id,
          actorId: ctx.actor.id,
          clusterId: guest.clusterId,
          vmid: guest.vmid,
          request: {
            cpuCores: deltaCores,
            memoryMb: deltaMemory,
            storageGb: 0,
            networkMbps: 0,
            guestCount: 0,
          },
        });
      }
      const provider = registry.forCluster(cluster);
      await provider.updateConfig(guest.vmid, guest.node, guest.type, {
        cores: nextCores,
        memoryMb: nextMemory,
        name: nextName,
      });
      updateGuestSpec(db, guest.id, { cores: nextCores, memoryMb: nextMemory });
      if (nextName !== guest.name) updateGuestRuntime(db, guest.id, { name: nextName });
      quotas.commit(reservationId);

      const durationMs = Date.now() - startedAt;
      finishOperation(db, operationId, { status: 'success', message: '配置已更新', durationMs });
      this.recordAudit(ctx, {
        action: 'guest.config.update',
        targetType: 'guest',
        targetId: guestTargetId(guest.clusterId, guest.vmid),
        result: 'success',
        detail: {
          operationId,
          vmid: guest.vmid,
          before: { cores: guest.cores, memoryMb: guest.memoryMb, name: guest.name },
          after: { cores: nextCores, memoryMb: nextMemory, name: nextName },
        },
      });
      const updated = getGuestById(db, guest.id);
      const operation = getOperation(db, operationId);
      if (!updated || !operation) throw new Error('更新后无法读取资源记录');
      return { guest: updated, operation };
    } catch (error) {
      quotas.release(reservationId);
      const denied = isAppError(error) && error.code === 'QUOTA_EXCEEDED';
      finishOperation(db, operationId, {
        status: denied ? 'denied' : 'failed',
        message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
      this.recordAudit(ctx, {
        action: 'guest.config.update',
        targetType: 'guest',
        targetId: guestTargetId(guest.clusterId, guest.vmid),
        result: denied ? 'denied' : 'failure',
        detail: {
          operationId,
          vmid: guest.vmid,
          error: error instanceof Error ? error.message : String(error),
          errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
          quotaDetails: isAppError(error) ? error.details : undefined,
        },
      });
      throw error;
    }
  }

  async deleteGuest(ctx: RequestContext, guest: GuestRecord): Promise<{ operation: OperationRecord }> {
    if (guest.template) throw conflict('模板资源不允许直接删除');
    this.assertAccess(ctx.actor, guest);
    const { db, registry } = this.deps;
    const operationId = newId();
    const startedAt = Date.now();
    insertOperation(db, {
      id: operationId,
      requestId: ctx.requestId,
      actorId: ctx.actor.id,
      actorName: ctx.actor.displayName,
      clusterId: guest.clusterId,
      vmid: guest.vmid,
      guestName: guest.name,
      action: 'guest.delete',
      params: { vmid: guest.vmid, type: guest.type },
      ip: ctx.ip,
    });
    try {
      const cluster = getCluster(db, guest.clusterId);
      if (!cluster) throw notFound('集群不存在');
      const provider = registry.forCluster(cluster);
      await provider.deleteGuest(guest.vmid, guest.node, guest.type);
      deleteGuestRow(db, guest.id);
      const durationMs = Date.now() - startedAt;
      finishOperation(db, operationId, { status: 'success', message: '资源已删除', durationMs });
      this.recordAudit(ctx, {
        action: 'guest.delete',
        targetType: 'guest',
        targetId: guestTargetId(guest.clusterId, guest.vmid),
        result: 'success',
        detail: {
          operationId,
          vmid: guest.vmid,
          name: guest.name,
          type: guest.type,
          cores: guest.cores,
          memoryMb: guest.memoryMb,
          diskGb: guest.diskGb,
          owner: guest.ownerName,
        },
      });
      const operation = getOperation(db, operationId);
      if (!operation) throw new Error('删除后无法读取操作记录');
      return { operation };
    } catch (error) {
      finishOperation(db, operationId, {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
      this.recordAudit(ctx, {
        action: 'guest.delete',
        targetType: 'guest',
        targetId: guestTargetId(guest.clusterId, guest.vmid),
        result: 'failure',
        detail: { operationId, vmid: guest.vmid, error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  async openConsole(
    ctx: RequestContext,
    guest: GuestRecord,
  ): Promise<{ session: ConsoleSessionRecord; operation: OperationRecord }> {
    this.assertAccess(ctx.actor, guest);
    if (guest.status !== 'running') throw conflict('资源未运行，无法打开控制台');
    const { db, registry, config } = this.deps;
    const cluster = getCluster(db, guest.clusterId);
    if (!cluster) throw notFound('集群不存在');
    const provider = registry.forCluster(cluster);
    const ticket = await provider.openConsole(guest.vmid, guest.node, guest.type);

    const operationId = newId();
    const startedAt = Date.now();
    const sessionId = newId();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + config.consoleTtlSec * 1000).toISOString();
    insertConsoleSession(db, {
      id: sessionId,
      actorId: ctx.actor.id,
      clusterId: guest.clusterId,
      vmid: guest.vmid,
      node: guest.node,
      guestType: guest.type,
      kind: ticket.kind,
      ticketEnc: encryptSecret(ticket.ticket, config.encryptionKey),
      ticketUser: ticket.user ?? '',
      port: ticket.port,
      upstreamPath: ticket.upstreamPath,
      createdAt,
      expiresAt,
    });
    insertOperation(db, {
      id: operationId,
      requestId: ctx.requestId,
      actorId: ctx.actor.id,
      actorName: ctx.actor.displayName,
      clusterId: guest.clusterId,
      vmid: guest.vmid,
      guestName: guest.name,
      action: 'guest.console.open',
      params: { kind: ticket.kind },
      ip: ctx.ip,
    });
    finishOperation(db, operationId, { status: 'success', message: '控制台会话已签发', durationMs: Date.now() - startedAt });
    this.recordAudit(ctx, {
      action: 'guest.console.open',
      targetType: 'guest',
      targetId: guestTargetId(guest.clusterId, guest.vmid),
      result: 'success',
      detail: { operationId, vmid: guest.vmid, sessionId, kind: ticket.kind, expiresAt },
    });
    const operation = getOperation(db, operationId);
    if (!operation) throw new Error('无法读取控制台操作记录');
    return {
      session: {
        id: sessionId,
        actorId: ctx.actor.id,
        clusterId: guest.clusterId,
        vmid: guest.vmid,
        node: guest.node,
        guestType: guest.type,
        kind: ticket.kind,
        port: ticket.port,
        upstreamPath: ticket.upstreamPath,
        ticketUser: ticket.user ?? '',
        createdAt,
        expiresAt,
      },
      operation,
    };
  }

  async markTemplate(ctx: RequestContext, guest: GuestRecord): Promise<{ guest: GuestRecord; operation: OperationRecord }> {
    this.assertAccess(ctx.actor, guest);
    if (guest.template) throw conflict('该资源已是模板');
    if (guest.status !== 'stopped') throw conflict('仅已停止的资源可以转换为模板');
    const { db, registry } = this.deps;
    const operationId = newId();
    const startedAt = Date.now();
    insertOperation(db, {
      id: operationId,
      requestId: ctx.requestId,
      actorId: ctx.actor.id,
      actorName: ctx.actor.displayName,
      clusterId: guest.clusterId,
      vmid: guest.vmid,
      guestName: guest.name,
      action: 'template.mark',
      params: { vmid: guest.vmid },
      ip: ctx.ip,
    });
    try {
      const cluster = getCluster(db, guest.clusterId);
      if (!cluster) throw notFound('集群不存在');
      const provider = registry.forCluster(cluster);
      await provider.markTemplate(guest.vmid, guest.node, guest.type);
      setGuestTemplate(db, guest.id, true);
      finishOperation(db, operationId, { status: 'success', message: '已转换为模板', durationMs: Date.now() - startedAt });
      this.recordAudit(ctx, {
        action: 'template.mark',
        targetType: 'guest',
        targetId: guestTargetId(guest.clusterId, guest.vmid),
        result: 'success',
        detail: { operationId, vmid: guest.vmid, name: guest.name },
      });
      const updated = getGuestById(db, guest.id);
      const operation = getOperation(db, operationId);
      if (!updated || !operation) throw new Error('无法读取模板操作记录');
      return { guest: updated, operation };
    } catch (error) {
      finishOperation(db, operationId, {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
      this.recordAudit(ctx, {
        action: 'template.mark',
        targetType: 'guest',
        targetId: guestTargetId(guest.clusterId, guest.vmid),
        result: 'failure',
        detail: { operationId, vmid: guest.vmid, error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  private assertAccess(actor: AuthUser, guest: GuestRecord): void {
    if (!canAccessGuest(actor, guest)) throw forbidden('该资源不在你的授权范围内');
  }

  private resolveOwner(actor: AuthUser, ownerId: string | null): UserRecord {
    const targetId = ownerId ?? actor.id;
    const target = findUserById(this.deps.db, targetId);
    if (!target) throw notFound('指定的资源归属用户不存在');
    if (target.id !== actor.id) {
      if (actor.roleScope === 'global') return target;
      if (actor.roleScope === 'department' && target.departmentId === actor.departmentId) return target;
      throw forbidden('无权为其他部门或用户开通资源');
    }
    return target;
  }

  private applyRuntime(guest: GuestRecord, status: GuestStatus): void {
    this.deps.db
      .prepare('UPDATE guests SET status = ?, uptime_sec = ?, updated_at = ? WHERE id = ?')
      .run(status, status === 'running' ? guest.uptimeSec : 0, new Date().toISOString(), guest.id);
  }

  private recordAudit(
    ctx: RequestContext,
    input: {
      action: string;
      targetType: string;
      targetId: string;
      result: 'success' | 'failure' | 'denied';
      detail: Record<string, unknown>;
    },
  ): void {
    const event = this.deps.audit.append({
      actorId: ctx.actor.id,
      actorName: ctx.actor.displayName,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      result: input.result,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      detail: input.detail,
    });
    this.deps.anomaly.evaluate(event);
  }
}
