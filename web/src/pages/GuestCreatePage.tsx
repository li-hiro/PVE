import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApiQuery, errorMessage } from '../lib/use-api';
import { formatMemory } from '../lib/format';
import type { ClusterRecord, DashboardOverview, GuestRecord, GuestType } from '../lib/types';
import { Card, ErrorBlock, LoadingBlock, PageHeader } from '../components/common';

interface Candidate {
  id: string;
  username: string;
  displayName: string;
  departmentId: string | null;
  departmentName: string | null;
}

interface FormState {
  clusterId: string;
  type: GuestType;
  templateId: string;
  name: string;
  node: string;
  cores: number;
  memoryMb: number;
  diskGb: number;
  storage: string;
  networkBridge: string;
  rateMbps: number;
  startOnCreate: boolean;
  ownerId: string;
}

const INITIAL: FormState = {
  clusterId: '',
  type: 'lxc',
  templateId: '',
  name: '',
  node: 'pve-01',
  cores: 2,
  memoryMb: 2048,
  diskGb: 20,
  storage: 'local-lvm',
  networkBridge: 'vmbr0',
  rateMbps: 100,
  startOnCreate: true,
  ownerId: '',
};

export function GuestCreatePage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const clusters = useApiQuery<ClusterRecord[]>('/clusters');
  const templates = useApiQuery<GuestRecord[]>('/guests/templates');
  const overview = useApiQuery<DashboardOverview>('/dashboard/overview');
  const candidates = useApiQuery<Candidate[]>(can('user.read') ? '/users/candidates' : null);

  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefilled = useRef(false);

  useEffect(() => {
    if (prefilled.current || !templates.data) return;
    const vmid = searchParams.get('template');
    if (!vmid) return;
    const template = templates.data.find((item) => String(item.vmid) === vmid);
    if (!template) return;
    prefilled.current = true;
    setForm((current) => ({
      ...current,
      templateId: String(template.vmid),
      type: template.type,
      node: template.node,
      cores: template.cores,
      memoryMb: template.memoryMb,
      diskGb: template.diskGb,
    }));
  }, [templates.data, searchParams]);

  useEffect(() => {
    const first = clusters.data?.[0];
    if (first && !form.clusterId) setForm((current) => ({ ...current, clusterId: first.id }));
  }, [clusters.data, form.clusterId]);

  const templateList = useMemo(
    () => (templates.data ?? []).filter((item) => item.type === form.type),
    [templates.data, form.type],
  );

  const nodeOptions = useMemo(() => {
    const nodes = new Map<string, string>();
    for (const node of overview.data?.nodes ?? []) nodes.set(node.node, node.node);
    for (const item of templates.data ?? []) nodes.set(item.node, item.node);
    for (const item of overview.data?.clusters ?? []) {
      if (item.provider === 'mock' && nodes.size === 0) {
        nodes.set('pve-01', 'pve-01');
        nodes.set('pve-02', 'pve-02');
      }
    }
    return [...nodes.keys()];
  }, [overview.data, templates.data]);

  const applyTemplate = (value: string): void => {
    if (!value) {
      setForm((current) => ({ ...current, templateId: '' }));
      return;
    }
    const template = (templates.data ?? []).find((item) => String(item.vmid) === value);
    if (!template) return;
    setForm((current) => ({
      ...current,
      templateId: value,
      type: template.type,
      node: template.node,
      cores: template.cores,
      memoryMb: template.memoryMb,
      diskGb: template.diskGb,
    }));
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const template = (templates.data ?? []).find((item) => String(item.vmid) === form.templateId);
    try {
      const result = await api.post<{ guest: GuestRecord }>('/guests', {
        clusterId: form.clusterId,
        type: form.type,
        name: form.name.trim(),
        node: form.node.trim(),
        cores: form.cores,
        memoryMb: form.memoryMb,
        diskGb: form.diskGb,
        storage: form.storage.trim(),
        templateId: template ? template.vmid : null,
        templateNode: template ? template.node : null,
        networkBridge: form.networkBridge.trim(),
        rateMbps: form.rateMbps,
        startOnCreate: form.startOnCreate,
        ownerId: form.ownerId || null,
      });
      navigate(`/guests/${result.guest.id}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  };

  if (clusters.loading && !clusters.data) return <LoadingBlock />;
  if (clusters.error) return <ErrorBlock message={clusters.error} onRetry={clusters.reload} />;

  return (
    <div className="page page-narrow">
      <PageHeader
        title="新建自助资源"
        description="从模板克隆或按规格创建虚拟机/容器；创建前会自动预占配额，避免并发超卖。"
        actions={
          <Link to="/guests" className="btn btn-ghost">
            返回列表
          </Link>
        }
      />

      <form className="form card form-card" onSubmit={submit}>
        <section className="form-section">
          <h2>基础信息</h2>
          <div className="form-grid">
            <label>
              目标集群
              <select
                value={form.clusterId}
                onChange={(event) => setForm({ ...form, clusterId: event.target.value })}
                required
              >
                <option value="">请选择集群</option>
                {(clusters.data ?? []).map((cluster) => (
                  <option key={cluster.id} value={cluster.id}>
                    {cluster.name}（{cluster.provider}）
                  </option>
                ))}
              </select>
            </label>
            <label>
              资源类型
              <select
                value={form.type}
                onChange={(event) => setForm({ ...form, type: event.target.value as GuestType, templateId: '' })}
              >
                <option value="lxc">LXC 容器</option>
                <option value="qemu">QEMU 虚拟机</option>
              </select>
            </label>
            <label>
              从模板创建
              <select value={form.templateId} onChange={(event) => applyTemplate(event.target.value)}>
                <option value="">不使用模板（全新创建）</option>
                {templateList.map((template) => (
                  <option key={template.id} value={String(template.vmid)}>
                    {template.name} · {template.node} · {template.cores} 核
                  </option>
                ))}
              </select>
            </label>
            <label>
              资源名称
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="例如 dev-sandbox-02"
                pattern="^[a-zA-Z0-9][a-zA-Z0-9._-]{1,62}$"
                title="以字母或数字开头，2-63 位，支持字母、数字、点、下划线与短横线"
                required
              />
            </label>
            <label>
              部署节点
              <input
                value={form.node}
                onChange={(event) => setForm({ ...form, node: event.target.value })}
                list="node-options"
                required
              />
              <datalist id="node-options">
                {nodeOptions.map((node) => (
                  <option key={node} value={node} />
                ))}
              </datalist>
            </label>
            {can('user.read') && candidates.data && candidates.data.length > 0 ? (
              <label>
                归属成员（可选）
                <select value={form.ownerId} onChange={(event) => setForm({ ...form, ownerId: event.target.value })}>
                  <option value="">归属当前账号</option>
                  {candidates.data.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.displayName}（{candidate.departmentName ?? '无部门'}）
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </section>

        <section className="form-section">
          <h2>规格与网络</h2>
          <div className="form-grid">
            <label>
              CPU 核数
              <input
                type="number"
                min={1}
                max={64}
                value={form.cores}
                onChange={(event) => setForm({ ...form, cores: Number(event.target.value) })}
                required
              />
            </label>
            <label>
              内存（MB）
              <input
                type="number"
                min={128}
                max={1048576}
                step={128}
                value={form.memoryMb}
                onChange={(event) => setForm({ ...form, memoryMb: Number(event.target.value) })}
                required
              />
              <span className="field-hint">约 {formatMemory(form.memoryMb)}</span>
            </label>
            <label>
              磁盘（GB）
              <input
                type="number"
                min={1}
                max={4096}
                value={form.diskGb}
                onChange={(event) => setForm({ ...form, diskGb: Number(event.target.value) })}
                required
              />
            </label>
            <label>
              存储卷
              <input
                value={form.storage}
                onChange={(event) => setForm({ ...form, storage: event.target.value })}
                required
              />
            </label>
            <label>
              网络桥接
              <input
                value={form.networkBridge}
                onChange={(event) => setForm({ ...form, networkBridge: event.target.value })}
                required
              />
            </label>
            <label>
              网络限速（Mbps，0 为不限）
              <input
                type="number"
                min={0}
                max={100000}
                value={form.rateMbps}
                onChange={(event) => setForm({ ...form, rateMbps: Number(event.target.value) })}
              />
            </label>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.startOnCreate}
              onChange={(event) => setForm({ ...form, startOnCreate: event.target.checked })}
            />
            创建完成后立即启动
          </label>
        </section>

        {error ? <div className="form-error">{error}</div> : null}

        <div className="form-actions">
          <Link to="/guests" className="btn btn-ghost">
            取消
          </Link>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? '创建中…' : '创建资源'}
          </button>
        </div>
      </form>

      <Card title="创建流程说明">
        <ol className="hint-list">
          <li>校验账号是否具备 guest.create 权限，以及目标资源是否在授权范围内。</li>
          <li>在 SQLite 立即事务中检查 CPU、内存、存储、带宽与实例数量五维配额，并写入预占记录。</li>
          <li>调用 PVE REST API（或演示集群 Provider）执行创建；失败会自动释放预占。</li>
          <li>成功后写入本地资源与操作流水，并把事件追加到 SHA-256 审计哈希链。</li>
        </ol>
      </Card>
    </div>
  );
}
