import { allRows, oneRow, runSql, type Db } from '../../db/index.js';
import type { QuotaPolicyRecord, QuotaUsage } from '../../domain.js';

interface QuotaRow {
  id: string;
  scope_type: 'department' | 'user';
  scope_id: string;
  cpu_cores: number | null;
  memory_mb: number | null;
  storage_gb: number | null;
  network_mbps: number | null;
  guest_limit: number | null;
  updated_at: string;
  scope_name: string | null;
}

const QUOTA_SELECT = `
  SELECT q.*,
    CASE q.scope_type
      WHEN 'department' THEN (SELECT name FROM departments d WHERE d.id = q.scope_id)
      ELSE (SELECT display_name FROM users u WHERE u.id = q.scope_id)
    END AS scope_name
  FROM quota_policies q
`;

const mapPolicy = (row: QuotaRow): QuotaPolicyRecord => ({
  id: row.id,
  scopeType: row.scope_type,
  scopeId: row.scope_id,
  scopeName: row.scope_name ?? row.scope_id,
  cpuCores: row.cpu_cores,
  memoryMb: row.memory_mb,
  storageGb: row.storage_gb,
  networkMbps: row.network_mbps,
  guestLimit: row.guest_limit,
  updatedAt: row.updated_at,
});

export function listQuotaPolicies(db: Db): QuotaPolicyRecord[] {
  return allRows<QuotaRow>(db, `${QUOTA_SELECT} ORDER BY q.scope_type ASC, q.scope_id ASC`).map(mapPolicy);
}

export const getQuotaPolicy = (
  db: Db,
  scopeType: 'department' | 'user',
  scopeId: string,
): QuotaPolicyRecord | null => {
  const row = oneRow<QuotaRow>(
    db,
    `${QUOTA_SELECT} WHERE q.scope_type = ? AND q.scope_id = ?`,
    scopeType,
    scopeId,
  );
  return row ? mapPolicy(row) : null;
};

export interface UpsertQuotaInput {
  scopeType: 'department' | 'user';
  scopeId: string;
  cpuCores: number | null;
  memoryMb: number | null;
  storageGb: number | null;
  networkMbps: number | null;
  guestLimit: number | null;
}

export function upsertQuotaPolicy(db: Db, input: UpsertQuotaInput): void {
  const now = new Date().toISOString();
  runSql(
    db,
    `INSERT INTO quota_policies (id, scope_type, scope_id, cpu_cores, memory_mb, storage_gb, network_mbps, guest_limit, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope_type, scope_id) DO UPDATE SET
       cpu_cores = excluded.cpu_cores,
       memory_mb = excluded.memory_mb,
       storage_gb = excluded.storage_gb,
       network_mbps = excluded.network_mbps,
       guest_limit = excluded.guest_limit,
       updated_at = excluded.updated_at`,
    `quota-${input.scopeType}-${input.scopeId}`,
    input.scopeType,
    input.scopeId,
    input.cpuCores,
    input.memoryMb,
    input.storageGb,
    input.networkMbps,
    input.guestLimit,
    now,
  );
}

export const deleteQuotaPolicy = (db: Db, scopeType: 'department' | 'user', scopeId: string): void => {
  runSql(db, 'DELETE FROM quota_policies WHERE scope_type = ? AND scope_id = ?', scopeType, scopeId);
};

export interface ReservationInput {
  id: string;
  scopeType: 'department' | 'user';
  scopeId: string;
  actorId: string;
  clusterId: string;
  vmid: number | null;
  cpuCores: number;
  memoryMb: number;
  storageGb: number;
  networkMbps: number;
  guestCount: number;
  expiresAt: string;
}

export function insertReservation(db: Db, input: ReservationInput): void {
  runSql(
    db,
    `INSERT INTO quota_reservations
       (id, scope_type, scope_id, actor_id, cluster_id, vmid, cpu_cores, memory_mb, storage_gb, network_mbps, guest_count, state, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    input.id,
    input.scopeType,
    input.scopeId,
    input.actorId,
    input.clusterId,
    input.vmid,
    input.cpuCores,
    input.memoryMb,
    input.storageGb,
    input.networkMbps,
    input.guestCount,
    new Date().toISOString(),
    input.expiresAt,
  );
}

export const setReservationState = (db: Db, id: string, state: 'committed' | 'released'): void => {
  runSql(db, 'UPDATE quota_reservations SET state = ? WHERE id = ? AND state = ?', state, id, 'active');
};

export const releaseExpiredReservations = (db: Db, nowIso: string): void => {
  runSql(
    db,
    "UPDATE quota_reservations SET state = 'released' WHERE state = 'active' AND expires_at < ?",
    nowIso,
  );
};

export function reservedUsage(
  db: Db,
  scopeType: 'department' | 'user',
  scopeId: string,
  nowIso: string,
): QuotaUsage {
  const row = oneRow<{
    cpu: number;
    memory: number;
    storage: number;
    network: number;
    guests: number;
  }>(
    db,
    `SELECT COALESCE(SUM(cpu_cores), 0) AS cpu, COALESCE(SUM(memory_mb), 0) AS memory,
            COALESCE(SUM(storage_gb), 0) AS storage, COALESCE(SUM(network_mbps), 0) AS network,
            COALESCE(SUM(guest_count), 0) AS guests
     FROM quota_reservations
     WHERE scope_type = ? AND scope_id = ? AND state = 'active' AND expires_at >= ?`,
    scopeType,
    scopeId,
    nowIso,
  );
  return {
    cpuCores: Number(row?.cpu ?? 0),
    memoryMb: Number(row?.memory ?? 0),
    storageGb: Number(row?.storage ?? 0),
    networkMbps: Number(row?.network ?? 0),
    guestCount: Number(row?.guests ?? 0),
  };
}
