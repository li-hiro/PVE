import { allRows, oneRow, runSql, type Db, type SqlValue } from '../../db/index.js';
import { canonicalJson, GENESIS_HASH, sha256Hex, newId } from '../../lib/digest.js';
import type { AuditEventInput, AuditEventRecord } from '../../domain.js';

interface AuditRow {
  seq: number;
  id: string;
  ts: string;
  actor_id: string | null;
  actor_name: string;
  action: string;
  target_type: string;
  target_id: string;
  result: 'success' | 'failure' | 'denied';
  ip: string;
  user_agent: string;
  request_id: string;
  detail: string;
  prev_hash: string;
  hash: string;
}

const mapEvent = (row: AuditRow): AuditEventRecord => ({
  seq: Number(row.seq),
  id: row.id,
  ts: row.ts,
  actorId: row.actor_id,
  actorName: row.actor_name,
  action: row.action,
  targetType: row.target_type,
  targetId: row.target_id,
  result: row.result,
  ip: row.ip,
  userAgent: row.user_agent,
  requestId: row.request_id,
  detail: parseDetail(row.detail),
  prevHash: row.prev_hash,
  hash: row.hash,
});

function parseDetail(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function hashEvent(row: Omit<AuditRow, 'hash'>): string {
  const payload = {
    seq: Number(row.seq),
    id: row.id,
    ts: row.ts,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    result: row.result,
    ip: row.ip,
    userAgent: row.user_agent,
    requestId: row.request_id,
    detail: parseDetail(row.detail),
  };
  return sha256Hex(`${row.prev_hash}\n${canonicalJson(payload)}`);
}

export interface AuditQuery {
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  result?: string;
  query?: string;
  from?: string;
  to?: string;
  scopeSql?: string;
  scopeParams?: SqlValue[];
  page: number;
  pageSize: number;
}

export interface AuditAppendResult {
  event: AuditEventRecord;
}

/**
 * 追加式审计账本：
 * 每条事件包含前一条事件的哈希，并对自身规范化载荷做 SHA-256，
 * 形成不可静默篡改的哈希链，可随时按区间校验。
 */
export class AuditLedger {
  constructor(private readonly db: Db) {}

  append(input: AuditEventInput): AuditEventRecord {
    const ts = input.ts ?? new Date().toISOString();
    const prev = oneRow<{ seq: number; hash: string }>(
      this.db,
      'SELECT seq, hash FROM audit_events ORDER BY seq DESC LIMIT 1',
    );
    const seq = Number(prev?.seq ?? 0) + 1;
    const prevHash = prev?.hash ?? GENESIS_HASH;
    const id = newId();
    const detail = canonicalJson(input.detail ?? {});
    const candidate: Omit<AuditRow, 'hash'> = {
      seq,
      id,
      ts,
      actor_id: input.actorId,
      actor_name: input.actorName,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      result: input.result,
      ip: input.ip ?? '',
      user_agent: input.userAgent ?? '',
      request_id: input.requestId ?? '',
      detail,
      prev_hash: prevHash,
    };
    const hash = hashEvent(candidate);
    runSql(
      this.db,
      `INSERT INTO audit_events (seq, id, ts, actor_id, actor_name, action, target_type, target_id, result, ip, user_agent, request_id, detail, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      seq,
      id,
      ts,
      input.actorId,
      input.actorName,
      input.action,
      input.targetType,
      input.targetId,
      input.result,
      input.ip ?? '',
      input.userAgent ?? '',
      input.requestId ?? '',
      detail,
      prevHash,
      hash,
    );
    return mapEvent({ ...candidate, hash });
  }

  list(query: AuditQuery): { items: AuditEventRecord[]; total: number } {
    const where: string[] = ['1 = 1'];
    const params: SqlValue[] = [];
    if (query.actorId) {
      where.push('actor_id = ?');
      params.push(query.actorId);
    }
    if (query.action) {
      where.push('action = ?');
      params.push(query.action);
    }
    if (query.targetType) {
      where.push('target_type = ?');
      params.push(query.targetType);
    }
    if (query.targetId) {
      where.push('target_id = ?');
      params.push(query.targetId);
    }
    if (query.result) {
      where.push('result = ?');
      params.push(query.result);
    }
    if (query.from) {
      where.push('ts >= ?');
      params.push(query.from);
    }
    if (query.to) {
      where.push('ts <= ?');
      params.push(query.to);
    }
    if (query.query) {
      const like = `%${query.query}%`;
      where.push('(actor_name LIKE ? OR action LIKE ? OR target_id LIKE ? OR detail LIKE ?)');
      params.push(like, like, like, like);
    }
    if (query.scopeSql) {
      where.push(query.scopeSql);
      params.push(...(query.scopeParams ?? []));
    }
    const whereSql = where.join(' AND ');
    const total = Number(
      (oneRow<{ n: number }>(
        this.db,
        `SELECT COUNT(*) AS n FROM audit_events WHERE ${whereSql}`,
        ...params,
      )?.n) ?? 0,
    );
    const rows = allRows<AuditRow>(
      this.db,
      `SELECT * FROM audit_events WHERE ${whereSql} ORDER BY seq DESC LIMIT ? OFFSET ?`,
      ...params,
      query.pageSize,
      (query.page - 1) * query.pageSize,
    );
    return { items: rows.map(mapEvent), total };
  }

  all(query: Omit<AuditQuery, 'page' | 'pageSize'>): AuditEventRecord[] {
    const pageSize = 5000;
    const result: AuditEventRecord[] = [];
    let page = 1;
    for (;;) {
      const batch = this.list({ ...query, page, pageSize });
      result.push(...batch.items);
      if (batch.items.length < pageSize || result.length >= batch.total) break;
      page += 1;
    }
    return result;
  }

  get(id: string): AuditEventRecord | null {
    const row = oneRow<AuditRow>(this.db, 'SELECT * FROM audit_events WHERE id = ?', id);
    return row ? mapEvent(row) : null;
  }

  timeline(targetType: string, targetId: string): AuditEventRecord[] {
    const rows = allRows<AuditRow>(
      this.db,
      'SELECT * FROM audit_events WHERE target_type = ? AND target_id = ? ORDER BY seq ASC',
      targetType,
      targetId,
    );
    return rows.map(mapEvent);
  }

  verify(fromSeq = 1, toSeq = Number.MAX_SAFE_INTEGER): {
    valid: boolean;
    checked: number;
    brokenAt: number | null;
    head: string;
    headSeq: number;
  } {
    const rows = allRows<AuditRow>(
      this.db,
      'SELECT * FROM audit_events WHERE seq >= ? AND seq <= ? ORDER BY seq ASC',
      fromSeq,
      toSeq,
    );
    let expectedPrev = fromSeq === 1 ? GENESIS_HASH : (oneRow<{ hash: string }>(
      this.db,
      'SELECT hash FROM audit_events WHERE seq < ? ORDER BY seq DESC LIMIT 1',
      fromSeq,
    )?.hash ?? GENESIS_HASH);
    let checked = 0;
    for (const row of rows) {
      checked += 1;
      if (row.prev_hash !== expectedPrev) {
        return { valid: false, checked, brokenAt: Number(row.seq), head: row.hash, headSeq: Number(row.seq) };
      }
      const { hash: storedHash, ...rest } = row;
      const recomputed = hashEvent(rest);
      if (recomputed !== storedHash) {
        return { valid: false, checked, brokenAt: Number(row.seq), head: row.hash, headSeq: Number(row.seq) };
      }
      expectedPrev = storedHash;
    }
    const last = oneRow<{ seq: number; hash: string }>(
      this.db,
      'SELECT seq, hash FROM audit_events ORDER BY seq DESC LIMIT 1',
    );
    return {
      valid: true,
      checked,
      brokenAt: null,
      head: last?.hash ?? GENESIS_HASH,
      headSeq: Number(last?.seq ?? 0),
    };
  }

  stats(range: {
    from?: string;
    to?: string;
    scopeSql?: string;
    scopeParams?: SqlValue[];
  }): {
    total: number;
    success: number;
    failure: number;
    denied: number;
    byAction: Array<{ action: string; count: number }>;
    byActor: Array<{ actorName: string; count: number }>;
    byResult: Array<{ result: string; count: number }>;
  } {
    const where: string[] = ['1 = 1'];
    const params: SqlValue[] = [];
    if (range.from) {
      where.push('ts >= ?');
      params.push(range.from);
    }
    if (range.to) {
      where.push('ts <= ?');
      params.push(range.to);
    }
    if (range.scopeSql) {
      where.push(range.scopeSql);
      params.push(...(range.scopeParams ?? []));
    }
    const whereSql = where.join(' AND ');
    const totals = allRows<{ result: string; n: number }>(
      this.db,
      `SELECT result, COUNT(*) AS n FROM audit_events WHERE ${whereSql} GROUP BY result`,
      ...params,
    );
    const byAction = allRows<{ action: string; n: number }>(
      this.db,
      `SELECT action, COUNT(*) AS n FROM audit_events WHERE ${whereSql} GROUP BY action ORDER BY n DESC LIMIT 12`,
      ...params,
    );
    const byActor = allRows<{ actor_name: string; n: number }>(
      this.db,
      `SELECT actor_name, COUNT(*) AS n FROM audit_events WHERE ${whereSql} GROUP BY actor_name ORDER BY n DESC LIMIT 10`,
      ...params,
    );
    let success = 0;
    let failure = 0;
    let denied = 0;
    for (const item of totals) {
      if (item.result === 'success') success = Number(item.n);
      else if (item.result === 'failure') failure = Number(item.n);
      else if (item.result === 'denied') denied = Number(item.n);
    }
    return {
      total: success + failure + denied,
      success,
      failure,
      denied,
      byAction: byAction.map((item) => ({ action: item.action, count: Number(item.n) })),
      byActor: byActor.map((item) => ({ actorName: item.actor_name, count: Number(item.n) })),
      byResult: totals.map((item) => ({ result: item.result, count: Number(item.n) })),
    };
  }

  recent(limit: number): AuditEventRecord[] {
    const rows = allRows<AuditRow>(this.db, 'SELECT * FROM audit_events ORDER BY seq DESC LIMIT ?', limit);
    return rows.map(mapEvent);
  }

  countRecent(query: {
    actorId?: string;
    actorName?: string;
    actions?: string[];
    result?: string;
    from: string;
  }): number {
    const where: string[] = ['ts >= ?'];
    const params: SqlValue[] = [query.from];
    if (query.actorId) {
      where.push('actor_id = ?');
      params.push(query.actorId);
    }
    if (query.actorName) {
      where.push('actor_name = ?');
      params.push(query.actorName);
    }
    if (query.actions && query.actions.length > 0) {
      where.push(`action IN (${query.actions.map(() => '?').join(', ')})`);
      params.push(...query.actions);
    }
    if (query.result) {
      where.push('result = ?');
      params.push(query.result);
    }
    return Number(
      (oneRow<{ n: number }>(
        this.db,
        `SELECT COUNT(*) AS n FROM audit_events WHERE ${where.join(' AND ')}`,
        ...params,
      )?.n) ?? 0,
    );
  }

  findByRequestId(requestId: string): AuditEventRecord[] {
    const rows = allRows<AuditRow>(
      this.db,
      'SELECT * FROM audit_events WHERE request_id = ? ORDER BY seq ASC',
      requestId,
    );
    return rows.map(mapEvent);
  }
}
