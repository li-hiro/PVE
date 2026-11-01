import { allRows, oneRow, runSql, type Db } from '../../db/index.js';
import type { MetricPoint, MetricsSample } from '../../domain.js';

export function insertMetricsSample(db: Db, sample: MetricsSample): void {
  runSql(
    db,
    `INSERT INTO metrics (cluster_id, node, cpu_pct, mem_pct, disk_pct, guests_running, guests_total, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    sample.clusterId,
    sample.node,
    sample.cpuPct,
    sample.memPct,
    sample.diskPct,
    sample.guestsRunning,
    sample.guestsTotal,
    sample.capturedAt,
  );
}

export function pruneMetrics(db: Db, beforeEpoch: number): void {
  runSql(db, 'DELETE FROM metrics WHERE captured_at < ?', beforeEpoch);
}

export function metricSeries(
  db: Db,
  options: { clusterId?: string; sinceEpoch: number; bucketMs: number },
): MetricPoint[] {
  const where: string[] = ['captured_at >= ?'];
  const params: (string | number)[] = [options.sinceEpoch];
  if (options.clusterId) {
    where.push('cluster_id = ?');
    params.push(options.clusterId);
  }
  const rows = allRows<{
    bucket: number;
    cpu: number;
    mem: number;
    running: number;
    total: number;
  }>(
    db,
    `SELECT CAST(captured_at / ? AS INTEGER) * ? AS bucket,
            AVG(cpu_pct) AS cpu, AVG(mem_pct) AS mem,
            MAX(guests_running) AS running, MAX(guests_total) AS total
     FROM metrics WHERE ${where.join(' AND ')}
     GROUP BY bucket ORDER BY bucket ASC`,
    options.bucketMs,
    options.bucketMs,
    ...params,
  );
  return rows.map((row) => ({
    bucket: Number(row.bucket),
    cpuPct: Math.round(Number(row.cpu) * 10) / 10,
    memPct: Math.round(Number(row.mem) * 10) / 10,
    guestsRunning: Number(row.running),
    guestsTotal: Number(row.total),
  }));
}

export interface NodeSnapshot {
  clusterId: string;
  node: string;
  cpuPct: number;
  memPct: number;
  diskPct: number;
  guestsRunning: number;
  guestsTotal: number;
  capturedAt: number;
}

export function latestNodeSnapshots(db: Db): NodeSnapshot[] {
  const rows = allRows<{
    cluster_id: string;
    node: string;
    cpu_pct: number;
    mem_pct: number;
    disk_pct: number;
    guests_running: number;
    guests_total: number;
    captured_at: number;
  }>(
    db,
    `SELECT m.cluster_id, m.node, m.cpu_pct, m.mem_pct, m.disk_pct, m.guests_running, m.guests_total, m.captured_at
     FROM metrics m
     JOIN (SELECT cluster_id, node, MAX(captured_at) AS ts FROM metrics GROUP BY cluster_id, node) latest
       ON latest.cluster_id = m.cluster_id AND latest.node = m.node AND latest.ts = m.captured_at
     ORDER BY m.cluster_id ASC, m.node ASC`,
  );
  return rows.map((row) => ({
    clusterId: row.cluster_id,
    node: row.node,
    cpuPct: Number(row.cpu_pct),
    memPct: Number(row.mem_pct),
    diskPct: Number(row.disk_pct),
    guestsRunning: Number(row.guests_running),
    guestsTotal: Number(row.guests_total),
    capturedAt: Number(row.captured_at),
  }));
}

export const latestSampleEpoch = (db: Db): number =>
  Number((oneRow<{ ts: number | null }>(db, 'SELECT MAX(captured_at) AS ts FROM metrics')?.ts) ?? 0);

export const countClustersWithMetrics = (db: Db): number =>
  Number((oneRow<{ n: number }>(db, 'SELECT COUNT(DISTINCT cluster_id) AS n FROM metrics')?.n) ?? 0);
