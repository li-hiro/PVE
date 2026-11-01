import { allRows, oneRow, runSql, type Db } from '../../db/index.js';
import type { ClusterRecord, ClusterStatus, ProviderKind } from '../../domain.js';

interface ClusterRow {
  id: string;
  name: string;
  provider: ProviderKind;
  api_url: string;
  token_id: string;
  token_secret_enc: string;
  verify_tls: number;
  status: ClusterStatus;
  version: string;
  node_count: number;
  enabled: number;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

const mapCluster = (row: ClusterRow): ClusterRecord => ({
  id: row.id,
  name: row.name,
  provider: row.provider,
  apiUrl: row.api_url,
  tokenId: row.token_id,
  tokenSecretEnc: row.token_secret_enc,
  verifyTls: row.verify_tls === 1,
  status: row.status,
  version: row.version,
  nodeCount: row.node_count,
  enabled: row.enabled === 1,
  lastSyncAt: row.last_sync_at,
  lastError: row.last_error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const listClusters = (db: Db): ClusterRecord[] =>
  allRows<ClusterRow>(db, 'SELECT * FROM clusters ORDER BY created_at ASC').map(mapCluster);

export const getCluster = (db: Db, id: string): ClusterRecord | null => {
  const row = oneRow<ClusterRow>(db, 'SELECT * FROM clusters WHERE id = ?', id);
  return row ? mapCluster(row) : null;
};

export const clusterNameExists = (db: Db, name: string, excludeId?: string): boolean => {
  const row = excludeId
    ? oneRow<{ id: string }>(db, 'SELECT id FROM clusters WHERE name = ? AND id <> ?', name, excludeId)
    : oneRow<{ id: string }>(db, 'SELECT id FROM clusters WHERE name = ?', name);
  return Boolean(row);
};

export interface CreateClusterInput {
  id: string;
  name: string;
  provider: ProviderKind;
  apiUrl: string;
  tokenId: string;
  tokenSecretEnc: string;
  verifyTls: boolean;
  enabled: boolean;
}

export function insertCluster(db: Db, input: CreateClusterInput): void {
  const now = new Date().toISOString();
  runSql(
    db,
    `INSERT INTO clusters (id, name, provider, api_url, token_id, token_secret_enc, verify_tls, status, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?, ?)`,
    input.id,
    input.name,
    input.provider,
    input.apiUrl,
    input.tokenId,
    input.tokenSecretEnc,
    input.verifyTls ? 1 : 0,
    input.enabled ? 1 : 0,
    now,
    now,
  );
}

export interface UpdateClusterPatch {
  name?: string;
  apiUrl?: string;
  tokenId?: string;
  tokenSecretEnc?: string;
  verifyTls?: boolean;
  enabled?: boolean;
}

export function updateCluster(db: Db, id: string, patch: UpdateClusterPatch): void {
  const columns: string[] = ['updated_at = ?'];
  const params: (string | number)[] = [new Date().toISOString()];
  const assign = (column: string, value: string | number | undefined): void => {
    if (value === undefined) return;
    columns.push(`${column} = ?`);
    params.push(value);
  };
  assign('name', patch.name);
  assign('api_url', patch.apiUrl);
  assign('token_id', patch.tokenId);
  assign('token_secret_enc', patch.tokenSecretEnc);
  assign('verify_tls', patch.verifyTls === undefined ? undefined : patch.verifyTls ? 1 : 0);
  assign('enabled', patch.enabled === undefined ? undefined : patch.enabled ? 1 : 0);
  runSql(db, `UPDATE clusters SET ${columns.join(', ')} WHERE id = ?`, ...params, id);
}

export function updateClusterHealth(
  db: Db,
  id: string,
  patch: { status: ClusterStatus; version?: string; nodeCount?: number; lastError?: string | null; lastSyncAt?: string | null },
): void {
  const columns: string[] = ['status = ?'];
  const params: (string | number | null)[] = [patch.status];
  if (patch.version !== undefined) {
    columns.push('version = ?');
    params.push(patch.version);
  }
  if (patch.nodeCount !== undefined) {
    columns.push('node_count = ?');
    params.push(patch.nodeCount);
  }
  if (patch.lastError !== undefined) {
    columns.push('last_error = ?');
    params.push(patch.lastError);
  }
  if (patch.lastSyncAt !== undefined) {
    columns.push('last_sync_at = ?');
    params.push(patch.lastSyncAt);
  }
  runSql(db, `UPDATE clusters SET ${columns.join(', ')} WHERE id = ?`, ...params, id);
}

export const deleteCluster = (db: Db, id: string): void => {
  runSql(db, 'DELETE FROM clusters WHERE id = ?', id);
};

export const countGuestsInCluster = (db: Db, id: string): number =>
  Number((oneRow<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM guests WHERE cluster_id = ?', id)?.n) ?? 0);
