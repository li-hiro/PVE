import { inTransaction, type Db } from '../db/index.js';
import { newId } from '../lib/digest.js';
import { quotaExceeded } from '../lib/errors.js';
import {
  getQuotaPolicy,
  insertReservation,
  releaseExpiredReservations,
  reservedUsage,
  setReservationState,
} from '../modules/quotas/quota-repo.js';
import { usageForScope } from '../modules/guests/guest-repo.js';
import type { QuotaLimits, QuotaPolicyRecord, QuotaSnapshot, QuotaUsage } from '../domain.js';

export interface QuotaRequest {
  cpuCores: number;
  memoryMb: number;
  storageGb: number;
  networkMbps: number;
  guestCount: number;
}

export type QuotaScopeType = 'department' | 'user';

export interface EffectiveQuota {
  source: 'user' | 'department' | 'none';
  inherited: boolean;
  limits: QuotaLimits;
  usageScopeType: QuotaScopeType;
  usageScopeId: string;
  policy: QuotaPolicyRecord | null;
}

const EMPTY_LIMITS: QuotaLimits = {
  cpuCores: null,
  memoryMb: null,
  storageGb: null,
  networkMbps: null,
  guestLimit: null,
};

const EMPTY_USAGE: QuotaUsage = {
  cpuCores: 0,
  memoryMb: 0,
  storageGb: 0,
  networkMbps: 0,
  guestCount: 0,
};

const toLimits = (policy: QuotaPolicyRecord | null): QuotaLimits =>
  policy
    ? {
        cpuCores: policy.cpuCores,
        memoryMb: policy.memoryMb,
        storageGb: policy.storageGb,
        networkMbps: policy.networkMbps,
        guestLimit: policy.guestLimit,
      }
    : { ...EMPTY_LIMITS };

export class QuotaService {
  constructor(private readonly db: Db) {}

  resolveUser(userId: string, departmentId: string | null): EffectiveQuota {
    const userPolicy = getQuotaPolicy(this.db, 'user', userId);
    if (userPolicy) {
      return {
        source: 'user',
        inherited: false,
        limits: toLimits(userPolicy),
        usageScopeType: 'user',
        usageScopeId: userId,
        policy: userPolicy,
      };
    }
    if (departmentId) {
      const deptPolicy = getQuotaPolicy(this.db, 'department', departmentId);
      if (deptPolicy) {
        return {
          source: 'department',
          inherited: true,
          limits: toLimits(deptPolicy),
          usageScopeType: 'department',
          usageScopeId: departmentId,
          policy: deptPolicy,
        };
      }
    }
    return {
      source: 'none',
      inherited: false,
      limits: { ...EMPTY_LIMITS },
      usageScopeType: 'user',
      usageScopeId: userId,
      policy: null,
    };
  }

  resolveScope(scopeType: QuotaScopeType, scopeId: string): EffectiveQuota {
    if (scopeType === 'department') {
      const policy = getQuotaPolicy(this.db, 'department', scopeId);
      return {
        source: policy ? 'department' : 'none',
        inherited: false,
        limits: toLimits(policy),
        usageScopeType: 'department',
        usageScopeId: scopeId,
        policy,
      };
    }
    const userPolicy = getQuotaPolicy(this.db, 'user', scopeId);
    if (userPolicy) {
      return {
        source: 'user',
        inherited: false,
        limits: toLimits(userPolicy),
        usageScopeType: 'user',
        usageScopeId: scopeId,
        policy: userPolicy,
      };
    }
    const deptRow = this.db.prepare('SELECT department_id FROM users WHERE id = ?').get(scopeId) as
      | { department_id: string | null }
      | undefined;
    const departmentId = deptRow?.department_id ?? null;
    if (departmentId) {
      const deptPolicy = getQuotaPolicy(this.db, 'department', departmentId);
      if (deptPolicy) {
        return {
          source: 'department',
          inherited: true,
          limits: toLimits(deptPolicy),
          usageScopeType: 'department',
          usageScopeId: departmentId,
          policy: deptPolicy,
        };
      }
    }
    return {
      source: 'none',
      inherited: false,
      limits: { ...EMPTY_LIMITS },
      usageScopeType: 'user',
      usageScopeId: scopeId,
      policy: null,
    };
  }

  snapshot(scopeType: QuotaScopeType, scopeId: string, name: string): QuotaSnapshot {
    const effective = this.resolveScope(scopeType, scopeId);
    const now = new Date().toISOString();
    const usage = usageForScope(this.db, {
      scopeType: effective.usageScopeType,
      scopeId: effective.usageScopeId,
    });
    const reserved = reservedUsage(this.db, effective.usageScopeType, effective.usageScopeId, now);
    return {
      scopeType,
      scopeId,
      scopeName: name,
      limits: effective.limits,
      usage,
      reserved,
      source: effective.source,
      inherited: effective.inherited,
      updatedAt: effective.policy?.updatedAt ?? null,
    };
  }

  /**
   * 原子预占配额：检查、预占写入在同一 SQLite 立即事务中完成，
   * 防止并发创建导致配额超卖。无配额策略时返回 null。
   */
  reserve(options: {
    scopeType: QuotaScopeType;
    scopeId: string;
    actorId: string;
    clusterId: string;
    vmid: number | null;
    request: QuotaRequest;
  }): string | null {
    const effective = this.resolveScope(options.scopeType, options.scopeId);
    const limits = effective.limits;
    const hasAnyLimit =
      limits.cpuCores !== null ||
      limits.memoryMb !== null ||
      limits.storageGb !== null ||
      limits.networkMbps !== null ||
      limits.guestLimit !== null;
    if (!hasAnyLimit) return null;

    return inTransaction(this.db, () => {
      const nowIso = new Date().toISOString();
      releaseExpiredReservations(this.db, nowIso);
      const usage = usageForScope(this.db, {
        scopeType: effective.usageScopeType,
        scopeId: effective.usageScopeId,
      });
      const reserved = reservedUsage(this.db, effective.usageScopeType, effective.usageScopeId, nowIso);
      const exceeded = this.findExceeded(limits, usage, reserved, options.request);
      if (exceeded.length > 0) {
        throw quotaExceeded('资源配额不足，操作已被拒绝', {
          scope: { type: options.scopeType, id: options.scopeId },
          usage,
          reserved,
          requested: options.request,
          dimensions: exceeded,
        });
      }
      const reservationId = newId();
      insertReservation(this.db, {
        id: reservationId,
        scopeType: effective.usageScopeType,
        scopeId: effective.usageScopeId,
        actorId: options.actorId,
        clusterId: options.clusterId,
        vmid: options.vmid,
        cpuCores: options.request.cpuCores,
        memoryMb: options.request.memoryMb,
        storageGb: options.request.storageGb,
        networkMbps: options.request.networkMbps,
        guestCount: options.request.guestCount,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });
      return reservationId;
    });
  }

  commit(reservationId: string | null): void {
    if (!reservationId) return;
    setReservationState(this.db, reservationId, 'committed');
  }

  release(reservationId: string | null): void {
    if (!reservationId) return;
    setReservationState(this.db, reservationId, 'released');
  }

  private findExceeded(
    limits: QuotaLimits,
    usage: QuotaUsage,
    reserved: QuotaUsage,
    request: QuotaRequest,
  ): Array<{ key: string; label: string; unit: string; limit: number; used: number; requested: number }> {
    const dimensions = [
      { key: 'cpuCores', label: 'CPU', unit: '核', limit: limits.cpuCores, used: usage.cpuCores + reserved.cpuCores, requested: request.cpuCores },
      { key: 'memoryMb', label: '内存', unit: 'MB', limit: limits.memoryMb, used: usage.memoryMb + reserved.memoryMb, requested: request.memoryMb },
      { key: 'storageGb', label: '存储', unit: 'GB', limit: limits.storageGb, used: usage.storageGb + reserved.storageGb, requested: request.storageGb },
      { key: 'networkMbps', label: '网络带宽', unit: 'Mbps', limit: limits.networkMbps, used: usage.networkMbps + reserved.networkMbps, requested: request.networkMbps },
      { key: 'guestLimit', label: '实例数量', unit: '个', limit: limits.guestLimit, used: usage.guestCount + reserved.guestCount, requested: request.guestCount },
    ];
    return dimensions
      .filter((dimension) => dimension.limit !== null && dimension.used + dimension.requested > dimension.limit)
      .map((dimension) => ({
        key: dimension.key,
        label: dimension.label,
        unit: dimension.unit,
        limit: Number(dimension.limit),
        used: dimension.used,
        requested: dimension.requested,
      }));
  }
}

export const emptyUsage = (): QuotaUsage => ({ ...EMPTY_USAGE });
