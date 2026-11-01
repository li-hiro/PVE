import { Agent, fetch as undiciFetch } from 'undici';
import { upstreamError } from '../lib/errors.js';
import type { GuestStatus, GuestType } from '../domain.js';
import {
  normalizeStatus,
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

export interface PveProviderOptions {
  apiUrl: string;
  tokenId: string;
  tokenSecret: string;
  verifyTls: boolean;
  timeoutMs?: number;
}

interface PveEnvelope<T> {
  data: T;
}

interface PveNodeStatus {
  cpu?: number;
  uptime?: number;
  maxcpu?: number;
  maxmem?: number;
  memory?: { total?: number; used?: number };
  rootfs?: { total?: number; used?: number };
}

interface PveResource {
  vmid?: number;
  name?: string;
  node?: string;
  type?: string;
  status?: string;
  maxcpu?: number;
  maxmem?: number;
  maxdisk?: number;
  template?: number;
  uptime?: number;
  tags?: string;
}

/**
 * Proxmox VE API2 客户端。
 *
 * 认证方式采用 API Token（PVEAPIToken=user@realm!tokenid=secret），
 * 仅依赖官方稳定的 REST 接口，不使用任何 PVE 内部库或闭源组件。
 */
export class PveApiProvider implements ClusterProvider {
  readonly kind = 'pve' as const;

  private readonly baseUrl: string;
  private readonly wsBaseUrl: string;
  private readonly tokenId: string;
  private readonly tokenSecret: string;
  private readonly timeoutMs: number;
  private readonly dispatcher: Agent | undefined;

  constructor(options: PveProviderOptions) {
    const apiUrl = options.apiUrl.replace(/\/+$/, '');
    this.baseUrl = apiUrl.includes('/api2/json') ? apiUrl : `${apiUrl}/api2/json`;
    const parsed = new URL(this.baseUrl);
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    this.wsBaseUrl = parsed.toString().replace(/\/+$/, '');
    this.tokenId = options.tokenId;
    this.tokenSecret = options.tokenSecret;
    this.timeoutMs = options.timeoutMs ?? 20000;
    this.dispatcher = options.verifyTls ? undefined : new Agent({ connect: { rejectUnauthorized: false } });
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `PVEAPIToken=${this.tokenId}=${this.tokenSecret}`,
      Accept: 'application/json',
    };
    let payload: URLSearchParams | undefined;
    if (body) {
      payload = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined || value === null) continue;
        payload.set(key, String(value));
      }
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(url, {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(this.timeoutMs),
        dispatcher: this.dispatcher,
      } as Parameters<typeof undiciFetch>[1]);
    } catch (error) {
      throw upstreamError('无法连接 PVE API', {
        url,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    const text = await response.text();
    if (!response.ok) {
      throw upstreamError(`PVE 接口返回 ${response.status}`, {
        path,
        status: response.status,
        body: text.slice(0, 400),
      });
    }
    if (!text) return {} as T;
    try {
      const parsed = JSON.parse(text) as PveEnvelope<T>;
      return parsed.data;
    } catch {
      throw upstreamError('PVE 返回了非 JSON 响应', { path, body: text.slice(0, 200) });
    }
  }

  async probe(): Promise<ProbeResult> {
    const version = await this.request<{ version?: string }>('GET', '/version');
    const nodes = await this.request<Array<{ node?: string }>>('GET', '/nodes');
    return {
      version: String(version.version ?? 'unknown'),
      nodeCount: Array.isArray(nodes) ? nodes.length : 0,
    };
  }

  async listNodes(): Promise<ProviderNodeInfo[]> {
    const nodes = await this.request<Array<{ node?: string; status?: string }>>('GET', '/nodes');
    const list = Array.isArray(nodes) ? nodes : [];
    const statuses = await Promise.all(
      list.map(async (node) => {
        const name = String(node.node ?? 'unknown');
        try {
          const status = await this.request<PveNodeStatus>('GET', `/nodes/${encodeURIComponent(name)}/status`);
          const memTotal = Number(status.memory?.total ?? 0) || 1;
          const memUsed = Number(status.memory?.used ?? 0);
          const rootTotal = Number(status.rootfs?.total ?? 0) || 1;
          const rootUsed = Number(status.rootfs?.used ?? 0);
          return {
            node: name,
            status: String(node.status ?? 'unknown'),
            cpuPct: Math.round(Number(status.cpu ?? 0) * 1000) / 10,
            memPct: Math.round((memUsed / memTotal) * 1000) / 10,
            diskPct: Math.round((rootUsed / rootTotal) * 1000) / 10,
            uptimeSec: Number(status.uptime ?? 0),
            maxCpu: Number(status.maxcpu ?? 1),
            maxMemMb: Math.round(memTotal / 1024 / 1024),
          } satisfies ProviderNodeInfo;
        } catch {
          return {
            node: name,
            status: String(node.status ?? 'unknown'),
            cpuPct: 0,
            memPct: 0,
            diskPct: 0,
            uptimeSec: 0,
            maxCpu: 1,
            maxMemMb: 0,
          } satisfies ProviderNodeInfo;
        }
      }),
    );
    return statuses;
  }

  async listGuests(): Promise<ProviderGuestInfo[]> {
    const resources = await this.request<PveResource[]>('GET', '/cluster/resources?type=vm');
    const list = Array.isArray(resources) ? resources : [];
    return list
      .filter((item) => item.type === 'qemu' || item.type === 'lxc')
      .map((item) => ({
        vmid: Number(item.vmid ?? 0),
        name: String(item.name ?? `${item.type}-${item.vmid}`),
        type: item.type as GuestType,
        node: String(item.node ?? 'unknown'),
        status: normalizeStatus(item.status),
        cores: Number(item.maxcpu ?? 0),
        memoryMb: Math.round(Number(item.maxmem ?? 0) / 1024 / 1024),
        diskGb: Math.round(Number(item.maxdisk ?? 0) / 1024 / 1024 / 1024),
        template: item.template === 1,
        uptimeSec: Number(item.uptime ?? 0),
        tags: String(item.tags ?? '')
          .split(';')
          .map((tag) => tag.trim())
          .filter(Boolean),
      }));
  }

  async metrics(nodes: ProviderNodeInfo[], guests: ProviderGuestInfo[]): Promise<ProviderMetricsInfo[]> {
    return nodes.map((node) => {
      const nodeGuests = guests.filter((guest) => guest.node === node.node && !guest.template);
      return {
        node: node.node,
        cpuPct: node.cpuPct,
        memPct: node.memPct,
        diskPct: node.diskPct,
        guestsRunning: nodeGuests.filter((guest) => guest.status === 'running').length,
        guestsTotal: nodeGuests.length,
      };
    });
  }

  private async nextVmid(): Promise<number> {
    const nextId = await this.request<number | string>('GET', '/cluster/nextid');
    return Number(nextId);
  }

  private networkString(type: GuestType, bridge: string, rateMbps: number): string {
    const rate = rateMbps > 0 ? `,rate=${rateMbps}` : '';
    return type === 'qemu' ? `virtio,bridge=${bridge}${rate}` : `name=eth0,bridge=${bridge}${rate}`;
  }

  async createGuest(spec: CreateGuestSpec): Promise<ProviderCreateResult> {
    const vmid = await this.nextVmid();
    if (spec.templateId !== null) {
      const templateNode = spec.templateNode ?? spec.node;
      const cloneBody: Record<string, string | number | boolean> =
        spec.type === 'qemu'
          ? { newid: vmid, name: spec.name, full: 1 }
          : { newid: vmid, hostname: spec.name, full: 1 };
      await this.request(
        'POST',
        `/nodes/${encodeURIComponent(templateNode)}/${spec.type}/${spec.templateId}/clone`,
        cloneBody,
      );
      if (spec.networkRateMbps > 0) {
        await this.applyNetworkRate(vmid, spec.node, spec.type, spec.networkRateMbps);
      }
    } else if (spec.type === 'qemu') {
      const body: Record<string, string | number> = {
        vmid,
        name: spec.name,
        cores: spec.cores,
        memory: spec.memoryMb,
        scsihw: 'virtio-scsi-pci',
        scsi0: `${spec.storage}:${spec.diskGb}`,
        net0: this.networkString('qemu', spec.networkBridge, spec.networkRateMbps),
        ostype: 'l26',
        boot: 'order=scsi0',
      };
      if (spec.iso) body.ide2 = `${spec.iso},media=cdrom`;
      await this.request('POST', `/nodes/${encodeURIComponent(spec.node)}/qemu`, body);
    } else {
      const ostemplate = spec.iso ?? '';
      if (!ostemplate) throw upstreamError('创建容器必须选择 LXC 模板');
      await this.request('POST', `/nodes/${encodeURIComponent(spec.node)}/lxc`, {
        vmid,
        hostname: spec.name,
        cores: spec.cores,
        memory: spec.memoryMb,
        rootfs: `${spec.storage}:${spec.diskGb}`,
        ostemplate,
        net0: this.networkString('lxc', spec.networkBridge, spec.networkRateMbps),
      });
    }

    if (spec.startOnCreate) {
      await this.power(vmid, spec.node, spec.type, 'start');
    }
    return { vmid, node: spec.node, status: spec.startOnCreate ? 'running' : 'stopped' };
  }

  private async applyNetworkRate(vmid: number, node: string, type: GuestType, rateMbps: number): Promise<void> {
    try {
      const config = await this.request<Record<string, unknown>>(
        'GET',
        `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/config`,
      );
      const net0 = config.net0 ? String(config.net0) : null;
      if (!net0) return;
      const next = /rate=\d+/.test(net0) ? net0.replace(/rate=\d+/, `rate=${rateMbps}`) : `${net0},rate=${rateMbps}`;
      await this.request('PUT', `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/config`, { net0: next });
    } catch {
      // 网络限速失败不阻断创建流程，配额仍按申请值记账
    }
  }

  async power(vmid: number, node: string, type: GuestType, action: PowerAction): Promise<GuestStatus> {
    if (type === 'lxc' && (action === 'reset' || action === 'suspend')) {
      throw upstreamError('LXC 容器不支持该电源操作', { action });
    }
    await this.request(
      'POST',
      `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/status/${action}`,
    );
    switch (action) {
      case 'start':
      case 'reboot':
      case 'reset':
        return 'running';
      case 'stop':
      case 'shutdown':
        return 'stopped';
      case 'suspend':
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
    const body: Record<string, string | number> = {};
    if (patch.cores !== undefined) body.cores = patch.cores;
    if (patch.memoryMb !== undefined) body.memory = patch.memoryMb;
    if (patch.name !== undefined && type === 'qemu') body.name = patch.name;
    if (Object.keys(body).length === 0) return;
    await this.request('PUT', `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/config`, body);
  }

  async deleteGuest(vmid: number, node: string, type: GuestType): Promise<void> {
    await this.request('DELETE', `/nodes/${encodeURIComponent(node)}/${type}/${vmid}?purge=1`);
  }

  async markTemplate(vmid: number, node: string, type: GuestType): Promise<void> {
    await this.request('POST', `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/template`);
  }

  async openConsole(vmid: number, node: string, type: GuestType): Promise<ProviderConsoleTicket> {
    const action = type === 'qemu' ? 'vncproxy' : 'termproxy';
    const result = await this.request<{ ticket?: string; port?: number; user?: string }>(
      'POST',
      `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/${action}`,
      { websocket: 1 },
    );
    const ticket = String(result.ticket ?? '');
    if (!ticket) throw upstreamError('PVE 未返回控制台票据');
    const port = Number(result.port ?? 0);
    const upstreamPath = `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/vncwebsocket?port=${port}&vncticket=${encodeURIComponent(ticket)}`;
    return {
      kind: type === 'qemu' ? 'vnc' : 'term',
      ticket,
      port,
      upstreamPath,
      password: type === 'qemu' ? ticket : null,
      user: String(result.user ?? ''),
    };
  }

  webSocketUrl(path: string): string {
    return `${this.wsBaseUrl}${path}`;
  }

  webSocketHeaders(): Record<string, string> {
    return { Authorization: `PVEAPIToken=${this.tokenId}=${this.tokenSecret}` };
  }
}
