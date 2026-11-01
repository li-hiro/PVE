import type { RoleScope } from './modules/rbac/catalog.js';

export type GuestType = 'qemu' | 'lxc';
export type GuestStatus = 'running' | 'stopped' | 'paused' | 'suspended' | 'unknown';
export type ProviderKind = 'pve' | 'mock';
export type ClusterStatus = 'online' | 'offline' | 'degraded' | 'unknown';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  departmentId: string | null;
  roleId: string;
  roleName: string;
  roleScope: RoleScope;
  permissions: string[];
  status: string;
}

export interface UserRecord extends AuthUser {
  passwordHash: string;
  email: string;
  createdAt: string;
  lastLoginAt: string | null;
  departmentName: string | null;
}

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
  tokenSecretEnc: string;
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

export interface QuotaPolicyRecord extends QuotaLimits {
  id: string;
  scopeType: 'department' | 'user';
  scopeId: string;
  scopeName: string;
  updatedAt: string;
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

export interface AuditEventInput {
  actorId: string | null;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  result: 'success' | 'failure' | 'denied';
  ip?: string;
  userAgent?: string;
  requestId?: string;
  detail?: Record<string, unknown>;
  ts?: string;
}

export interface ConsoleSessionRecord {
  id: string;
  actorId: string;
  clusterId: string;
  vmid: number;
  node: string;
  guestType: GuestType;
  kind: 'vnc' | 'term';
  port: number;
  upstreamPath: string;
  ticketUser: string;
  expiresAt: string;
  createdAt: string;
}

export interface MetricsSample {
  clusterId: string;
  node: string;
  cpuPct: number;
  memPct: number;
  diskPct: number;
  guestsRunning: number;
  guestsTotal: number;
  capturedAt: number;
}

export interface MetricPoint {
  bucket: number;
  cpuPct: number;
  memPct: number;
  guestsRunning: number;
  guestsTotal: number;
}
