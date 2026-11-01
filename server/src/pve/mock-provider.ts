import { randomUUID } from 'node:crypto';
import { badRequest, notFound, upstreamError } from '../lib/errors.js';
import type { GuestStatus, GuestType } from '../domain.js';
import {
  type ClusterProvider,
  type CreateGuestSpec,
  type PowerAction,
  type ProbeResult,
  type ProviderConsoleTicket,
  type ProviderCreateResult,
  type ProviderGuestInfo,
  type ProviderMetricsInfo,
  type ProviderNodeInfo,
} from './types.js';

interface MockGuest extends ProviderGuestInfo {
  ownerUsername: string | null;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const SEED_GUESTS: MockGuest[] = [
  { vmid: 900, name: 'ubuntu-2404-cloud-template', type: 'qemu', node: 'pve-01', status: 'stopped', cores: 2, memoryMb: 2048, diskGb: 20, template: true, uptimeSec: 0, tags: ['template', 'ubuntu'], ownerUsername: null },
  { vmid: 901, name: 'debian-12-lxc-template', type: 'lxc', node: 'pve-02', status: 'stopped', cores: 2, memoryMb: 2048, diskGb: 8, template: true, uptimeSec: 0, tags: ['template', 'debian'], ownerUsername: null },
  { vmid: 101, name: 'web-prod-01', type: 'qemu', node: 'pve-01', status: 'running', cores: 4, memoryMb: 8192, diskGb: 40, template: false, uptimeSec: 9_400_000, tags: ['web', 'prod'], ownerUsername: 'alice' },
  { vmid: 102, name: 'web-prod-02', type: 'qemu', node: 'pve-02', status: 'running', cores: 4, memoryMb: 8192, diskGb: 40, template: false, uptimeSec: 5_600_000, tags: ['web', 'prod'], ownerUsername: 'alice' },
  { vmid: 103, name: 'api-cache-01', type: 'lxc', node: 'pve-01', status: 'running', cores: 2, memoryMb: 2048, diskGb: 16, template: false, uptimeSec: 1_800_000, tags: ['cache'], ownerUsername: 'bob' },
  { vmid: 104, name: 'ci-runner-01', type: 'qemu', node: 'pve-02', status: 'stopped', cores: 8, memoryMb: 16384, diskGb: 80, template: false, uptimeSec: 0, tags: ['ci'], ownerUsername: 'bob' },
  { vmid: 105, name: 'dev-sandbox-01', type: 'lxc', node: 'pve-01', status: 'running', cores: 2, memoryMb: 4096, diskGb: 20, template: false, uptimeSec: 864_000, tags: ['dev'], ownerUsername: 'bob' },
  { vmid: 106, name: 'finance-erp-01', type: 'qemu', node: 'pve-01', status: 'running', cores: 4, memoryMb: 8192, diskGb: 60, template: false, uptimeSec: 12_000_000, tags: ['finance', 'prod'], ownerUsername: 'dave' },
  { vmid: 107, name: 'finance-report-01', type: 'lxc', node: 'pve-02', status: 'stopped', cores: 2, memoryMb: 2048, diskGb: 16, template: false, uptimeSec: 0, tags: ['finance'], ownerUsername: 'dave' },
  { vmid: 108, name: 'biz-portal-01', type: 'qemu', node: 'pve-01', status: 'running', cores: 2, memoryMb: 4096, diskGb: 40, template: false, uptimeSec: 3_200_000, tags: ['biz', 'prod'], ownerUsername: 'frank' },
  { vmid: 109, name: 'biz-crm-01', type: 'lxc', node: 'pve-02', status: 'running', cores: 2, memoryMb: 4096, diskGb: 24, template: false, uptimeSec: 2_100_000, tags: ['biz'], ownerUsername: 'frank' },
  { vmid: 110, name: 'lab-test-01', type: 'qemu', node: 'pve-01', status: 'stopped', cores: 2, memoryMb: 4096, diskGb: 20, template: false, uptimeSec: 0, tags: ['lab'], ownerUsername: 'bob' },
  { vmid: 111, name: 'lab-test-02', type: 'lxc', node: 'pve-02', status: 'stopped', cores: 1, memoryMb: 1024, diskGb: 10, template: false, uptimeSec: 0, tags: ['lab'], ownerUsername: 'bob' },
  { vmid: 112, name: 'ops-jump-01', type: 'lxc', node: 'pve-01', status: 'running', cores: 1, memoryMb: 1024, diskGb: 10, template: false, uptimeSec: 40_000_000, tags: ['ops'], ownerUsername: 'admin' },
];

/**
 * 内存态演示集群：无需真实 PVE 即可体验完整业务流程，同时作为集成测试的可控后端。
 * 该实现独立编写，仅模拟 PVE 语义，不依赖任何第三方模拟库。
 */
export class MockProvider implements ClusterProvider {
  readonly kind = 'mock' as const;

  private guests: MockGuest[];
  private readonly latencyMs: number;
  private nextVmid: number;

  constructor(options: { latencyMs?: number; seed?: boolean } = {}) {
    this.latencyMs = options.latencyMs ?? 30;
    this.guests = options.seed === false ? [] : SEED_GUESTS.map((guest) => ({ ...guest, tags: [...guest.tags] }));
    this.nextVmid = Math.max(200, ...this.guests.map((guest) => guest.vmid)) + 1;
  }

  async probe(): Promise<ProbeResult> {
    return { version: '8.2.4 (mock)', nodeCount: 2 };
  }

  async listNodes(): Promise<ProviderNodeInfo[]> {
    const now = Date.now();
    const wave = Math.sin(now / 300_000);
    const nodes = [
      { node: 'pve-01', cpu: 46 + wave * 12, mem: 63 + wave * 6, disk: 58 },
      { node: 'pve-02', cpu: 31 - wave * 9, mem: 47 - wave * 4, disk: 42 },
    ];
    return nodes.map((node) => {
      const nodeGuests = this.guests.filter((guest) => guest.node === node.node && !guest.template);
      return {
        node: node.node,
        status: 'online',
        cpuPct: Math.max(5, Math.round(node.cpu * 10) / 10),
        memPct: Math.max(5, Math.round(node.mem * 10) / 10),
        diskPct: node.disk,
        uptimeSec: 32_000_000,
        maxCpu: 32,
        maxMemMb: 131072,
        guestsRunning: nodeGuests.filter((guest) => guest.status === 'running').length,
        guestsTotal: nodeGuests.length,
      };
    });
  }

  async listGuests(): Promise<ProviderGuestInfo[]> {
    return this.guests.map((guest) => ({ ...guest, tags: [...guest.tags] }));
  }

  async metrics(nodes: ProviderNodeInfo[]): Promise<ProviderMetricsInfo[]> {
    return nodes.map((node) => ({
      node: node.node,
      cpuPct: node.cpuPct,
      memPct: node.memPct,
      diskPct: node.diskPct,
      guestsRunning: node.guestsRunning ?? 0,
      guestsTotal: node.guestsTotal ?? 0,
    }));
  }

  async createGuest(spec: CreateGuestSpec): Promise<ProviderCreateResult> {
    await delay(this.latencyMs);
    if (spec.name.trim().length === 0) throw badRequest('资源名称不能为空');
    if (spec.templateId !== null) {
      const template = this.guests.find((guest) => guest.vmid === spec.templateId && guest.template);
      if (!template) throw notFound('所选模板不存在');
      if (template.type !== spec.type) throw badRequest('模板类型与请求的资源类型不一致');
    }
    const vmid = this.nextVmid++;
    this.guests.push({
      vmid,
      name: spec.name,
      type: spec.type,
      node: spec.node,
      status: spec.startOnCreate ? 'running' : 'stopped',
      cores: spec.cores,
      memoryMb: spec.memoryMb,
      diskGb: spec.diskGb,
      template: false,
      uptimeSec: spec.startOnCreate ? 30 : 0,
      tags: ['self-service'],
      ownerUsername: null,
    });
    return { vmid, node: spec.node, status: spec.startOnCreate ? 'running' : 'stopped' };
  }

  async power(vmid: number, node: string, type: GuestType, action: PowerAction): Promise<GuestStatus> {
    await delay(this.latencyMs);
    const guest = this.guests.find((item) => item.vmid === vmid && item.node === node && item.type === type);
    if (!guest) throw notFound('目标资源不存在');
    if (type === 'lxc' && (action === 'reset' || action === 'suspend')) {
      throw upstreamError('LXC 容器不支持该电源操作');
    }
    switch (action) {
      case 'start':
      case 'reboot':
      case 'reset':
        guest.status = 'running';
        guest.uptimeSec = action === 'start' ? 30 : guest.uptimeSec;
        return 'running';
      case 'stop':
      case 'shutdown':
        guest.status = 'stopped';
        guest.uptimeSec = 0;
        return 'stopped';
      case 'suspend':
        guest.status = 'suspended';
        return 'suspended';
      default:
        return 'unknown';
    }
  }

  async updateConfig(
    vmid: number,
    node: string,
    type: GuestType,
    patch: { cores?: number; memoryMb?: number; name?: string },
  ): Promise<void> {
    await delay(this.latencyMs);
    const guest = this.guests.find((item) => item.vmid === vmid && item.node === node && item.type === type);
    if (!guest) throw notFound('目标资源不存在');
    if (guest.template) throw badRequest('模板资源不允许调整运行规格');
    if (patch.cores !== undefined) guest.cores = patch.cores;
    if (patch.memoryMb !== undefined) guest.memoryMb = patch.memoryMb;
    if (patch.name !== undefined) guest.name = patch.name;
  }

  async deleteGuest(vmid: number, node: string, type: GuestType): Promise<void> {
    await delay(this.latencyMs);
    const guest = this.guests.find((item) => item.vmid === vmid && item.node === node && item.type === type);
    if (!guest) throw notFound('目标资源不存在');
    if (guest.template) throw badRequest('模板资源不允许直接删除');
    this.guests = this.guests.filter((item) => item.vmid !== vmid);
  }

  async markTemplate(vmid: number, node: string, type: GuestType): Promise<void> {
    await delay(this.latencyMs);
    const guest = this.guests.find((item) => item.vmid === vmid && item.node === node && item.type === type);
    if (!guest) throw notFound('目标资源不存在');
    if (guest.status !== 'stopped') throw badRequest('仅已停止的资源可以转换为模板');
    guest.template = true;
    guest.status = 'stopped';
  }

  async openConsole(vmid: number, node: string, type: GuestType): Promise<ProviderConsoleTicket> {
    const guest = this.guests.find((item) => item.vmid === vmid && item.node === node && item.type === type);
    if (!guest) throw notFound('目标资源不存在');
    return {
      kind: type === 'qemu' ? 'vnc' : 'term',
      ticket: `mock-${randomUUID()}`,
      port: type === 'qemu' ? 5900 : 0,
      upstreamPath: `mock://${type}/${vmid}`,
      password: type === 'qemu' ? `mock-${vmid}` : null,
      user: 'mock',
    };
  }

  webSocketUrl(path: string): string {
    return path;
  }

  webSocketHeaders(): Record<string, string> {
    return {};
  }
}

/**
 * 用于测试的可编程 Mock：允许注入失败状态，验证异常路径。
 */
export class ScriptedMockProvider extends MockProvider {
  private failNext = false;

  failOnce(): void {
    this.failNext = true;
  }

  override async createGuest(spec: CreateGuestSpec): Promise<ProviderCreateResult> {
    if (this.failNext) {
      this.failNext = false;
      throw upstreamError('模拟创建失败');
    }
    return super.createGuest(spec);
  }
}
