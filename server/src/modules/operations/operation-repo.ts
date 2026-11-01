import { allRows, oneRow, runSql, type Db } from '../../db/index.js';
import type { OperationRecord, OperationStatus } from '../../domain.js';

interface OperationRow {
  id: string;
  request_id: string;
  actor_id: string | null;
  actor_name: string;
  cluster_id: string;
  vmid: number | null;
  guest_name: string;
  action: string;
  params: string;
  status: OperationStatus;
  message: string;
  ip: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
}

const parseJson = (raw: string): Record<string, unknown> => {
  try {
    const value = JSON.parse(raw) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const mapOperation = (row: OperationRow): OperationRecord => ({
  id: row.id,
  requestId: row.request_id,
  actorId: row.actor_id,
  actorName: row.actor_name,
  clusterId: row.cluster_id,
  vmid: row.vmid,
  guestName: row.guest_name,
  action: row.action,
  params: parseJson(row.params),
  status: row.status,
  message: row.message,
  ip: row.ip,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  durationMs: row.duration_ms,
});

export interface CreateOperationInput {
  id: string;
  requestId: string;
  actorId: string | null;
  actorName: string;
  clusterId: string;
  vmid: number | null;
  guestName: string;
  action: string;
  params: Record<string, unknown>;
  ip: string;
}

export function insertOperation(db: Db, input: CreateOperationInput): void {
  runSql(
    db,
    `INSERT INTO operations (id, request_id, actor_id, actor_name, cluster_id, vmid, guest_name, action, params, status, ip, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    input.id,
    input.requestId,
    input.actorId,
    input.actorName,
    input.clusterId,
    input.vmid,
    input.guestName,
    input.action,
    JSON.stringify(input.params),
    input.ip,
    new Date().toISOString(),
  );
}

export function finishOperation(
  db: Db,
  id: string,
  patch: { status: OperationStatus; message: string; durationMs: number; guestName?: string; vmid?: number | null },
): void {
  const columns: string[] = ['status = ?', 'message = ?', 'duration_ms = ?', 'finished_at = ?'];
  const params: (string | number | null)[] = [patch.status, patch.message, patch.durationMs, new Date().toISOString()];
  if (patch.guestName !== undefined) {
    columns.push('guest_name = ?');
    params.push(patch.guestName);
  }
  if (patch.vmid !== undefined) {
    columns.push('vmid = ?');
    params.push(patch.vmid);
  }
  runSql(db, `UPDATE operations SET ${columns.join(', ')} WHERE id = ?`, ...params, id);
}

export const getOperation = (db: Db, id: string): OperationRecord | null => {
  const row = oneRow<OperationRow>(db, 'SELECT * FROM operations WHERE id = ?', id);
  return row ? mapOperation(row) : null;
};

export interface ListOperationFilters {
  actorId?: string;
  clusterId?: string;
  vmid?: number;
  action?: string;
  status?: OperationStatus;
  query?: string;
  from?: string;
  to?: string;
  scopeSql?: string;
  scopeParams?: (string | number)[];
  page: number;
  pageSize: number;
}

export function listOperations(
  db: Db,
  filters: ListOperationFilters,
): { items: OperationRecord[]; total: number } {
  const where: string[] = ['1 = 1'];
  const params: (string | number)[] = [];
  if (filters.actorId) {
    where.push('actor_id = ?');
    params.push(filters.actorId);
  }
  if (filters.clusterId) {
    where.push('cluster_id = ?');
    params.push(filters.clusterId);
  }
  if (filters.vmid !== undefined) {
    where.push('vmid = ?');
    params.push(filters.vmid);
  }
  if (filters.action) {
    where.push('action = ?');
    params.push(filters.action);
  }
  if (filters.status) {
    where.push('status = ?');
    params.push(filters.status);
  }
  if (filters.query) {
    const like = `%${filters.query}%`;
    where.push('(guest_name LIKE ? OR CAST(vmid AS TEXT) LIKE ? OR actor_name LIKE ?)');
    params.push(like, like, like);
  }
  if (filters.from) {
    where.push('started_at >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('started_at <= ?');
    params.push(filters.to);
  }
  if (filters.scopeSql) {
    where.push(filters.scopeSql);
    params.push(...(filters.scopeParams ?? []));
  }
  const whereSql = where.join(' AND ');
  const total = Number(
    (oneRow<{ n: number }>(db, `SELECT COUNT(*) AS n FROM operations WHERE ${whereSql}`, ...params)?.n) ?? 0,
  );
  const rows = allRows<OperationRow>(
    db,
    `SELECT * FROM operations WHERE ${whereSql} ORDER BY started_at DESC LIMIT ? OFFSET ?`,
    ...params,
    filters.pageSize,
    (filters.page - 1) * filters.pageSize,
  );
  return { items: rows.map(mapOperation), total };
}

export const countOperationsSince = (db: Db, sinceIso: string): number =>
  Number((oneRow<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM operations WHERE started_at >= ?', sinceIso)?.n) ?? 0);

export const countFailedOperationsSince = (db: Db, sinceIso: string): number =>
  Number(
    (
      oneRow<{ n: number }>(
        db,
        "SELECT COUNT(*) AS n FROM operations WHERE started_at >= ? AND status = 'failed'",
        sinceIso,
      )?.n
    ) ?? 0,
  );

export function hasRecentOperation(
  db: Db,
  options: { clusterId: string; vmid: number; actions: string[]; sinceIso: string },
): boolean {
  const row = oneRow<{ id: string }>(
    db,
    `SELECT id FROM operations
     WHERE cluster_id = ? AND vmid = ? AND status = 'success' AND started_at >= ?
       AND action IN (${options.actions.map(() => '?').join(', ')})
     LIMIT 1`,
    options.clusterId,
    options.vmid,
    options.sinceIso,
    ...options.actions,
  );
  return Boolean(row);
}
