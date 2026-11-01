import type { GuestStatus, GuestType, ProviderKind } from '../domain.js';

export interface ProviderNodeInfo {
  node: string;
  status: string;
  cpuPct: number;
  memPct: number;
  diskPct: number;
  uptimeSec: number;
  maxCpu: number;
  maxMemMb: number;
  guestsRunning?: number;
  guestsTotal?: number;
}

export interface ProviderGuestInfo {
  vmid: number;
  name: string;
  type: GuestType;
  node: string;
  status: GuestStatus;
  cores: number;
  memoryMb: number;
  diskGb: number;
  template: boolean;
  uptimeSec: number;
  tags: string[];
  ownerUsername?: string | null;
}

export interface ProviderMetricsInfo {
  node: string;
  cpuPct: number;
  memPct: number;
  diskPct: number;
  guestsRunning: number;
  guestsTotal: number;
}

export interface CreateGuestSpec {
  type: GuestType;
  name: string;
  node: string;
  cores: number;
  memoryMb: number;
  diskGb: number;
  storage: string;
  templateId: number | null;
  templateNode: string | null;
  iso: string | null;
  networkBridge: string;
  networkRateMbps: number;
  startOnCreate: boolean;
}

export interface ProviderCreateResult {
  vmid: number;
  node: string;
  status: GuestStatus;
}

export type PowerAction = 'start' | 'stop' | 'shutdown' | 'reboot' | 'reset' | 'suspend';

export interface ProviderConsoleTicket {
  kind: 'vnc' | 'term';
  ticket: string;
  port: number;
  upstreamPath: string;
  password: string | null;
  user?: string | null;
}

export interface ProbeResult {
  version: string;
  nodeCount: number;
}

/**
 * 集群提供方抽象。新增虚拟化后端（如第二套 PVE、嵌套集群）只需实现该接口，
 * 并在 provider-registry 中注册，即可被上层操作管道复用。
 */
export interface ClusterProvider {
  readonly kind: ProviderKind;
  probe(): Promise<ProbeResult>;
  listNodes(): Promise<ProviderNodeInfo[]>;
  listGuests(): Promise<ProviderGuestInfo[]>;
  metrics(nodes: ProviderNodeInfo[], guests: ProviderGuestInfo[]): Promise<ProviderMetricsInfo[]>;
  createGuest(spec: CreateGuestSpec): Promise<ProviderCreateResult>;
  power(vmid: number, node: string, type: GuestType, action: PowerAction): Promise<GuestStatus>;
  updateConfig(
    vmid: number,
    node: string,
    type: GuestType,
    patch: { cores?: number; memoryMb?: number; name?: string },
  ): Promise<void>;
  deleteGuest(vmid: number, node: string, type: GuestType): Promise<void>;
  markTemplate(vmid: number, node: string, type: GuestType): Promise<void>;
  openConsole(vmid: number, node: string, type: GuestType): Promise<ProviderConsoleTicket>;
  webSocketUrl(path: string): string;
  webSocketHeaders(): Record<string, string>;
}

export const normalizeStatus = (raw: string | undefined): GuestStatus => {
  switch (raw) {
    case 'running':
      return 'running';
    case 'stopped':
      return 'stopped';
    case 'paused':
      return 'paused';
    case 'suspended':
      return 'suspended';
    default:
      return 'unknown';
  }
};
