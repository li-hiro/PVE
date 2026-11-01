/**
 * 与后端 REST 契约一一对应的前端类型定义。
 * 任何字段调整都应同步 server/src/domain.ts，保持一致。
 */

export type RoleScope = 'global' | 'department' | 'own';
export type GuestType = 'qemu' | 'lxc';
export type GuestStatus = 'running' | 'stopped' | 'paused' | 'suspended' | 'unknown';
export type ClusterStatus = 'online' | 'offline' | 'degraded' | 'unknown';
export type ProviderKind = 'pve' | 'mock';

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  departmentId: string | null;
  departmentName: string | null;
  roleId: string;
  roleName: string;
  roleScope: RoleScope;
  permissions: string[];
  status: string;
  email: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface PermissionDefinition {
  key: string;
  label: string;
  group: string;
  description: string;
}

export interface RoleRecord {
  id: string;
  name: string;
  description: string;
  scope: RoleScope;
  permissions: string[];
  builtin: boolean;
  createdAt: string;
  userCount?: number;
}

export interface DepartmentRecord {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  userCount?: number;
  guestCount?: number;
}

export interface ClusterRecord {
  id: string;
  name: string;
  provider: ProviderKind;
  apiUrl: string;
  tokenId: string;
  tokenSecretSet: boolean;
  verifyTls: boolean;
  status: ClusterStatus;
  version: string;
  nodeCount: number;
  enabled: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GuestRecord {
  id: string;
  clusterId: string;
  clusterName: string;
  vmid: number;
  type: GuestType;
  name: string;
  node: string;
  status: GuestStatus;
  cores: number;
  memoryMb: number;
  diskGb: number;
  networkMbps: number;
  template: boolean;
  ownerId: string | null;
  ownerName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  tags: string[];
  uptimeSec: number;
  lastSeenStatus: string;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuotaLimits {
  cpuCores: number | null;
  memoryMb: number | null;
  storageGb: number | null;
  networkMbps: number | null;
  guestLimit: number | null;
}

export interface QuotaUsage {
  cpuCores: number;
  memoryMb: number;
  storageGb: number;
  networkMbps: number;
  guestCount: number;
}

export interface QuotaSnapshot {
  scopeType: 'department' | 'user';
  scopeId: string;
  scopeName: string;
  limits: QuotaLimits;
  usage: QuotaUsage;
  reserved: QuotaUsage;
  source: 'user' | 'department' | 'none';
  inherited: boolean;
  updatedAt: string | null;
}

export type OperationStatus = 'pending' | 'success' | 'failed' | 'denied';

export interface OperationRecord {
  id: string;
  requestId: string;
  actorId: string | null;
  actorName: string;
  clusterId: string;
  vmid: number | null;
  guestName: string;
  action: string;
  params: Record<string, unknown>;
  status: OperationStatus;
  message: string;
  ip: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'open' | 'ack' | 'closed';

export interface AlertRecord {
  id: string;
  category: 'anomaly' | 'resource' | 'availability' | 'operation';
  rule: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  targetType: string;
  targetId: string;
  status: AlertStatus;
  createdAt: string;
  ackedAt: string | null;
  ackedBy: string | null;
}

export interface AuditEventRecord {
  seq: number;
  id: string;
  ts: string;
  actorId: string | null;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  result: 'success' | 'failure' | 'denied';
  ip: string;
  userAgent: string;
  requestId: string;
  detail: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface AuditStats {
  total: number;
  success: number;
  failure: number;
  denied: number;
  byAction: Array<{ action: string; count: number }>;
  byActor: Array<{ actorName: string; count: number }>;
  byResult: Array<{ result: string; count: number }>;
}

export interface VerifyReport {
  valid: boolean;
  checked: number;
  brokenAt: number | null;
  head: string;
  headSeq: number;
}

export interface NodeSnapshot {
  node: string;
  clusterId?: string;
  status?: string;
  cpuPct: number;
  memPct: number;
  diskPct: number;
  guestsRunning: number;
  guestsTotal: number;
  capturedAt?: number;
  uptimeSec?: number;
  maxCpu?: number;
  maxMemMb?: number;
}

export interface MetricPoint {
  bucket: number;
  cpuPct: number;
  memPct: number;
  guestsRunning: number;
  guestsTotal: number;
}

export interface AlertSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
}

export interface DashboardOverview {
  generatedAt: string;
  demoMode: boolean;
  clusters: ClusterRecord[];
  guests: { total: number; running: number; stopped: number; templates: number };
  nodes: NodeSnapshot[];
  metrics: { range: string; label: string; bucketMs: number; points: MetricPoint[] };
  alerts: { summary: AlertSummary; recent: AlertRecord[]; anomaly: AlertRecord[] };
  operations: OperationRecord[];
  audit: { summary: AuditStats; recent: AuditEventRecord[] };
  quotas: QuotaSnapshot[];
}

export interface GuestDetail {
  guest: GuestRecord;
  operations: OperationRecord[];
  timeline: AuditEventRecord[];
  quota: QuotaSnapshot | null;
}

export interface ConsoleSession {
  sessionId: string;
  kind: 'vnc' | 'term';
  guestType: GuestType;
  expiresAt: string;
  upstreamPort: number;
}

export interface BootstrapInfo {
  name: string;
  version: string;
  description: string;
  demoMode: boolean;
  permissions: PermissionDefinition[];
  serverTime: string;
  features: Record<string, boolean>;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}
