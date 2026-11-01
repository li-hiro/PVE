import { allRows, oneRow, runSql, type Db } from '../../db/index.js';
import type {
  ConsoleSessionRecord,
  GuestRecord,
  GuestStatus,
  GuestType,
  QuotaUsage,
} from '../../domain.js';

interface GuestRow {
  id: string;
  cluster_id: string;
  vmid: number;
  type: GuestType;
  name: string;
  node: string;
  status: GuestStatus;
  cores: number;
  memory_mb: number;
  disk_gb: number;
  network_mbps: number;
  template: number;
  owner_id: string | null;
  department_id: string | null;
  tags: string;
  uptime_sec: number;
  last_seen_status: string;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
  cluster_name: string;
  owner_name: string | null;
  department_name: string | null;
}

const GUEST_SELECT = `
  SELECT g.*, c.name AS cluster_name, u.display_name AS owner_name, d.name AS department_name
  FROM guests g
  JOIN clusters c ON c.id = g.cluster_id
  LEFT JOIN users u ON u.id = g.owner_id
  LEFT JOIN departments d ON d.id = g.department_id
`;

const parseTags = (raw: string): string[] => {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

const mapGuest = (row: GuestRow): GuestRecord => ({
  id: row.id,
  clusterId: row.cluster_id,
  clusterName: row.cluster_name,
  vmid: row.vmid,
  type: row.type,
  name: row.name,
  node: row.node,
  status: row.status,
  cores: row.cores,
  memoryMb: row.memory_mb,
  diskGb: row.disk_gb,
  networkMbps: row.network_mbps,
  template: row.template === 1,
  ownerId: row.owner_id,
  ownerName: row.owner_name,
  departmentId: row.department_id,
  departmentName: row.department_name,
  tags: parseTags(row.tags),
  uptimeSec: row.uptime_sec,
  lastSeenStatus: row.last_seen_status,
  lastSyncAt: row.last_sync_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export interface ListGuestFilters {
  clusterId?: string;
  status?: string;
  type?: GuestType;
  template?: boolean;
  departmentId?: string;
  ownerId?: string;
  query?: string;
  scopeSql?: string;
  scopeParams?: (string | number)[];
  page: number;
  pageSize: number;
  sort?: 'name' | 'vmid' | 'updated';
}

export function listGuests(db: Db, filters: ListGuestFilters): { items: GuestRecord[]; total: number } {
  const where: string[] = ['1 = 1'];
  const params: (string | number)[] = [];
  if (filters.clusterId) {
    where.push('g.cluster_id = ?');
    params.push(filters.clusterId);
  }
  if (filters.status) {
    where.push('g.status = ?');
    params.push(filters.status);
  }
  if (filters.type) {
    where.push('g.type = ?');
    params.push(filters.type);
  }
  if (filters.template !== undefined) {
    where.push('g.template = ?');
    params.push(filters.template ? 1 : 0);
  }
  if (filters.departmentId) {
    where.push('g.department_id = ?');
    params.push(filters.departmentId);
  }
  if (filters.ownerId) {
    where.push('g.owner_id = ?');
    params.push(filters.ownerId);
  }
  if (filters.query) {
    const like = `%${filters.query}%`;
    where.push('(g.name LIKE ? OR CAST(g.vmid AS TEXT) LIKE ?)');
    params.push(like, like);
  }
  if (filters.scopeSql) {
    where.push(filters.scopeSql);
    params.push(...(filters.scopeParams ?? []));
  }
  const whereSql = where.join(' AND ');
  const total = Number(
    (oneRow<{ n: number }>(db, `SELECT COUNT(*) AS n FROM guests g WHERE ${whereSql}`, ...params)?.n) ?? 0,
  );
  const order = filters.sort === 'name' ? 'g.name ASC' : filters.sort === 'updated' ? 'g.updated_at DESC' : 'g.cluster_id ASC, g.vmid ASC';
  const rows = allRows<GuestRow>(
    db,
    `${GUEST_SELECT} WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...params,
    filters.pageSize,
    (filters.page - 1) * filters.pageSize,
  );
  return { items: rows.map(mapGuest), total };
}

export const getGuestById = (db: Db, id: string): GuestRecord | null => {
  const row = oneRow<GuestRow>(db, `${GUEST_SELECT} WHERE g.id = ?`, id);
  return row ? mapGuest(row) : null;
};

export const findGuestByVm = (db: Db, clusterId: string, vmid: number): GuestRecord | null => {
  const row = oneRow<GuestRow>(db, `${GUEST_SELECT} WHERE g.cluster_id = ? AND g.vmid = ?`, clusterId, vmid);
  return row ? mapGuest(row) : null;
};

export interface SyncedGuestInput {
  id: string;
  clusterId: string;
  vmid: number;
  type: GuestType;
  name: string;
  node: string;
  status: GuestStatus;
  cores: number;
  memoryMb: number;
  diskGb: number;
  template: boolean;
  tags: string[];
  uptimeSec: number;
}

export function upsertSyncedGuest(db: Db, input: SyncedGuestInput): void {
  const now = new Date().toISOString();
  runSql(
    db,
    `INSERT INTO guests (id, cluster_id, vmid, type, name, node, status, cores, memory_mb, disk_gb, network_mbps, template, tags, uptime_sec, last_seen_status, last_sync_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cluster_id, vmid) DO UPDATE SET
       name = excluded.name,
       node = excluded.node,
       status = excluded.status,
       cores = excluded.cores,
       memory_mb = excluded.memory_mb,
       disk_gb = excluded.disk_gb,
       template = excluded.template,
       tags = excluded.tags,
       uptime_sec = excluded.uptime_sec,
       last_seen_status = guests.status,
       last_sync_at = excluded.last_sync_at,
       updated_at = excluded.updated_at`,
    input.id,
    input.clusterId,
    input.vmid,
    input.type,
    input.name,
    input.node,
    input.status,
    input.cores,
    input.memoryMb,
    input.diskGb,
    input.template ? 1 : 0,
    JSON.stringify(input.tags),
    input.uptimeSec,
    input.status,
    now,
    now,
    now,
  );
}

export interface CreatedGuestInput {
  id: string;
  clusterId: string;
  vmid: number;
  type: GuestType;
  name: string;
  node: string;
  status: GuestStatus;
  cores: number;
  memoryMb: number;
  diskGb: number;
  networkMbps: number;
  ownerId: string;
  departmentId: string | null;
  tags: string[];
}

export function insertCreatedGuest(db: Db, input: CreatedGuestInput): void {
  const now = new Date().toISOString();
  runSql(
    db,
    `INSERT INTO guests (id, cluster_id, vmid, type, name, node, status, cores, memory_mb, disk_gb, network_mbps, template, owner_id, department_id, tags, uptime_sec, last_seen_status, last_sync_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?, ?, ?, ?)
     ON CONFLICT(cluster_id, vmid) DO UPDATE SET
       owner_id = excluded.owner_id,
       department_id = excluded.department_id,
       network_mbps = excluded.network_mbps,
       name = excluded.name,
       updated_at = excluded.updated_at`,
    input.id,
    input.clusterId,
    input.vmid,
    input.type,
    input.name,
    input.node,
    input.status,
    input.cores,
    input.memoryMb,
    input.diskGb,
    input.networkMbps,
    input.ownerId,
    input.departmentId,
    JSON.stringify(input.tags),
    input.status,
    now,
    now,
    now,
  );
}

export function updateGuestRuntime(
  db: Db,
  id: string,
  patch: { status?: GuestStatus; uptimeSec?: number; node?: string; name?: string; lastSeenStatus?: string },
): void {
  const columns: string[] = ['updated_at = ?'];
  const params: (string | number)[] = [new Date().toISOString()];
  if (patch.status !== undefined) {
    columns.push('status = ?');
    params.push(patch.status);
  }
  if (patch.uptimeSec !== undefined) {
    columns.push('uptime_sec = ?');
    params.push(patch.uptimeSec);
  }
  if (patch.node !== undefined) {
    columns.push('node = ?');
    params.push(patch.node);
  }
  if (patch.name !== undefined) {
    columns.push('name = ?');
    params.push(patch.name);
  }
  if (patch.lastSeenStatus !== undefined) {
    columns.push('last_seen_status = ?');
    params.push(patch.lastSeenStatus);
  }
  runSql(db, `UPDATE guests SET ${columns.join(', ')} WHERE id = ?`, ...params, id);
}

export function updateGuestSpec(
  db: Db,
  id: string,
  patch: { cores?: number; memoryMb?: number; diskGb?: number; networkMbps?: number },
): void {
  const columns: string[] = ['updated_at = ?'];
  const params: (string | number)[] = [new Date().toISOString()];
  if (patch.cores !== undefined) {
    columns.push('cores = ?');
    params.push(patch.cores);
  }
  if (patch.memoryMb !== undefined) {
    columns.push('memory_mb = ?');
    params.push(patch.memoryMb);
  }
  if (patch.diskGb !== undefined) {
    columns.push('disk_gb = ?');
    params.push(patch.diskGb);
  }
  if (patch.networkMbps !== undefined) {
    columns.push('network_mbps = ?');
    params.push(patch.networkMbps);
  }
  runSql(db, `UPDATE guests SET ${columns.join(', ')} WHERE id = ?`, ...params, id);
}

export const deleteGuestRow = (db: Db, id: string): void => {
  runSql(db, 'DELETE FROM guests WHERE id = ?', id);
};

export function assignGuestOwner(
  db: Db,
  id: string,
  ownerId: string | null,
  departmentId: string | null,
): void {
  runSql(
    db,
    'UPDATE guests SET owner_id = ?, department_id = ?, updated_at = ? WHERE id = ?',
    ownerId,
    departmentId,
    new Date().toISOString(),
    id,
  );
}

export function setGuestTemplate(db: Db, id: string, template: boolean): void {
  runSql(
    db,
    'UPDATE guests SET template = ?, updated_at = ? WHERE id = ?',
    template ? 1 : 0,
    new Date().toISOString(),
    id,
  );
}

export interface UsageQuery {
  scopeType: 'department' | 'user';
  scopeId: string;
}

export function usageForScope(db: Db, query: UsageQuery): QuotaUsage {
  const column = query.scopeType === 'department' ? 'department_id' : 'owner_id';
  const row = oneRow<{
    cpu: number;
    memory: number;
    storage: number;
    network: number;
    guests: number;
  }>(
    db,
    `SELECT COALESCE(SUM(cores), 0) AS cpu, COALESCE(SUM(memory_mb), 0) AS memory,
            COALESCE(SUM(disk_gb), 0) AS storage, COALESCE(SUM(network_mbps), 0) AS network,
            COUNT(*) AS guests
     FROM guests WHERE template = 0 AND ${column} = ?`,
    query.scopeId,
  );
  return {
    cpuCores: Number(row?.cpu ?? 0),
    memoryMb: Number(row?.memory ?? 0),
    storageGb: Number(row?.storage ?? 0),
    networkMbps: Number(row?.network ?? 0),
    guestCount: Number(row?.guests ?? 0),
  };
}

export function departmentUsage(
  db: Db,
): Array<{ departmentId: string; departmentName: string; usage: QuotaUsage }> {
  const rows = allRows<{
    department_id: string;
    department_name: string;
    cpu: number;
    memory: number;
    storage: number;
    network: number;
    guests: number;
  }>(
    db,
    `SELECT g.department_id, d.name AS department_name,
            COALESCE(SUM(g.cores), 0) AS cpu, COALESCE(SUM(g.memory_mb), 0) AS memory,
            COALESCE(SUM(g.disk_gb), 0) AS storage, COALESCE(SUM(g.network_mbps), 0) AS network,
            COUNT(*) AS guests
     FROM guests g JOIN departments d ON d.id = g.department_id
     WHERE g.template = 0
     GROUP BY g.department_id, d.name`,
  );
  return rows.map((row) => ({
    departmentId: row.department_id,
    departmentName: row.department_name,
    usage: {
      cpuCores: Number(row.cpu),
      memoryMb: Number(row.memory),
      storageGb: Number(row.storage),
      networkMbps: Number(row.network),
      guestCount: Number(row.guests),
    },
  }));
}

export function guestStatusSummary(
  db: Db,
): { total: number; running: number; stopped: number; templates: number } {
  const rows = allRows<{ status: string; template: number; n: number }>(
    db,
    `SELECT status, template, COUNT(*) AS n FROM guests GROUP BY status, template`,
  );
  let running = 0;
  let stopped = 0;
  let templates = 0;
  let total = 0;
  for (const row of rows) {
    total += Number(row.n);
    if (row.template === 1) {
      templates += Number(row.n);
      continue;
    }
    if (row.status === 'running') running += Number(row.n);
    if (row.status === 'stopped') stopped += Number(row.n);
  }
  return { total, running, stopped, templates };
}

export const listTemplates = (db: Db, scopeSql?: string, scopeParams?: (string | number)[]): GuestRecord[] => {
  const where = ['g.template = 1'];
  if (scopeSql) where.push(scopeSql);
  const rows = allRows<GuestRow>(
    db,
    `${GUEST_SELECT} WHERE ${where.join(' AND ')} ORDER BY g.name ASC`,
    ...(scopeParams ?? []),
  );
  return rows.map(mapGuest);
};

export const countGuestsByCluster = (db: Db, clusterId: string): number =>
  Number((oneRow<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM guests WHERE cluster_id = ?', clusterId)?.n) ?? 0);

export const countGuestsByDepartment = (db: Db, departmentId: string): number =>
  Number((oneRow<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM guests WHERE department_id = ?', departmentId)?.n) ?? 0);

interface ConsoleSessionRow {
  id: string;
  actor_id: string;
  cluster_id: string;
  vmid: number;
  node: string;
  guest_type: GuestType;
  kind: 'vnc' | 'term';
  ticket_enc: string;
  ticket_user: string;
  port: number;
  upstream_path: string;
  created_at: string;
  expires_at: string;
}

const mapConsoleSession = (row: ConsoleSessionRow): ConsoleSessionRecord => ({
  id: row.id,
  actorId: row.actor_id,
  clusterId: row.cluster_id,
  vmid: row.vmid,
  node: row.node,
  guestType: row.guest_type,
  kind: row.kind,
  port: row.port,
  upstreamPath: row.upstream_path,
  ticketUser: row.ticket_user,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
});

export interface ConsoleSessionInput extends ConsoleSessionRecord {
  ticketEnc: string;
}

export function insertConsoleSession(db: Db, input: ConsoleSessionInput): void {
  runSql(
    db,
    `INSERT INTO console_sessions (id, actor_id, cluster_id, vmid, node, guest_type, kind, ticket_enc, ticket_user, port, upstream_path, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.actorId,
    input.clusterId,
    input.vmid,
    input.node,
    input.guestType,
    input.kind,
    input.ticketEnc,
    input.ticketUser,
    input.port,
    input.upstreamPath,
    input.createdAt,
    input.expiresAt,
  );
}

export const getConsoleSession = (db: Db, id: string): (ConsoleSessionRecord & { ticketEnc: string }) | null => {
  const row = oneRow<ConsoleSessionRow>(db, 'SELECT * FROM console_sessions WHERE id = ?', id);
  if (!row) return null;
  return { ...mapConsoleSession(row), ticketEnc: row.ticket_enc };
};

export const deleteExpiredConsoleSessions = (db: Db, nowIso: string): void => {
  runSql(db, 'DELETE FROM console_sessions WHERE expires_at < ?', nowIso);
};

export const deleteConsoleSession = (db: Db, id: string): void => {
  runSql(db, 'DELETE FROM console_sessions WHERE id = ?', id);
};
