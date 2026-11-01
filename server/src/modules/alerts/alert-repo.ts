import { allRows, oneRow, runSql, type Db } from '../../db/index.js';
import type { AlertRecord, AlertSeverity, AlertStatus } from '../../domain.js';

interface AlertRow {
  id: string;
  category: AlertRecord['category'];
  rule: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  target_type: string;
  target_id: string;
  status: AlertStatus;
  created_at: string;
  acked_at: string | null;
  acked_by: string | null;
}

const mapAlert = (row: AlertRow): AlertRecord => ({
  id: row.id,
  category: row.category,
  rule: row.rule,
  severity: row.severity,
  title: row.title,
  message: row.message,
  targetType: row.target_type,
  targetId: row.target_id,
  status: row.status,
  createdAt: row.created_at,
  ackedAt: row.acked_at,
  ackedBy: row.acked_by,
});

export interface CreateAlertInput {
  id: string;
  category: AlertRecord['category'];
  rule: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  targetType: string;
  targetId: string;
}

export function insertAlert(db: Db, input: CreateAlertInput): void {
  runSql(
    db,
    `INSERT INTO alerts (id, category, rule, severity, title, message, target_type, target_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    input.id,
    input.category,
    input.rule,
    input.severity,
    input.title,
    input.message,
    input.targetType,
    input.targetId,
    new Date().toISOString(),
  );
}

export const hasRecentAlert = (db: Db, rule: string, targetId: string, sinceIso: string): boolean => {
  const row = oneRow<{ id: string }>(
    db,
    'SELECT id FROM alerts WHERE rule = ? AND target_id = ? AND created_at >= ? LIMIT 1',
    rule,
    targetId,
    sinceIso,
  );
  return Boolean(row);
};

export interface ListAlertFilters {
  status?: AlertStatus;
  severity?: AlertSeverity;
  category?: AlertRecord['category'];
  query?: string;
  excludeCategory?: AlertRecord['category'];
  page: number;
  pageSize: number;
}

export function listAlerts(
  db: Db,
  filters: ListAlertFilters,
): { items: AlertRecord[]; total: number } {
  const where: string[] = ['1 = 1'];
  const params: (string | number)[] = [];
  if (filters.status) {
    where.push('status = ?');
    params.push(filters.status);
  }
  if (filters.severity) {
    where.push('severity = ?');
    params.push(filters.severity);
  }
  if (filters.category) {
    where.push('category = ?');
    params.push(filters.category);
  }
  if (filters.excludeCategory) {
    where.push('category <> ?');
    params.push(filters.excludeCategory);
  }
  if (filters.query) {
    const like = `%${filters.query}%`;
    where.push('(title LIKE ? OR message LIKE ? OR target_id LIKE ?)');
    params.push(like, like, like);
  }
  const whereSql = where.join(' AND ');
  const total = Number(
    (oneRow<{ n: number }>(db, `SELECT COUNT(*) AS n FROM alerts WHERE ${whereSql}`, ...params)?.n) ?? 0,
  );
  const rows = allRows<AlertRow>(
    db,
    `SELECT * FROM alerts WHERE ${whereSql} ORDER BY
       CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
       created_at DESC
     LIMIT ? OFFSET ?`,
    ...params,
    filters.pageSize,
    (filters.page - 1) * filters.pageSize,
  );
  return { items: rows.map(mapAlert), total };
}

export const getAlert = (db: Db, id: string): AlertRecord | null => {
  const row = oneRow<AlertRow>(db, 'SELECT * FROM alerts WHERE id = ?', id);
  return row ? mapAlert(row) : null;
};

export function ackAlert(db: Db, id: string, actorId: string): boolean {
  const result = runSql(
    db,
    "UPDATE alerts SET status = 'ack', acked_at = ?, acked_by = ? WHERE id = ? AND status = 'open'",
    new Date().toISOString(),
    actorId,
    id,
  );
  return result.changes > 0;
}

export function countOpenAlerts(db: Db): { total: number; critical: number; warning: number; info: number } {
  const rows = allRows<{ severity: AlertSeverity; n: number }>(
    db,
    "SELECT severity, COUNT(*) AS n FROM alerts WHERE status = 'open' GROUP BY severity",
  );
  const summary = { total: 0, critical: 0, warning: 0, info: 0 };
  for (const row of rows) {
    const count = Number(row.n);
    summary.total += count;
    summary[row.severity] += count;
  }
  return summary;
}

export const listRecentAlerts = (db: Db, limit: number, excludeCategory?: AlertRecord['category']): AlertRecord[] => {
  const rows = excludeCategory
    ? allRows<AlertRow>(
        db,
        'SELECT * FROM alerts WHERE category <> ? ORDER BY created_at DESC LIMIT ?',
        excludeCategory,
        limit,
      )
    : allRows<AlertRow>(db, 'SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?', limit);
  return rows.map(mapAlert);
};

export const countAlertsSince = (db: Db, sinceIso: string): number =>
  Number((oneRow<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM alerts WHERE created_at >= ?', sinceIso)?.n) ?? 0);
