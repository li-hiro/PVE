import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApiQuery, errorMessage } from '../lib/use-api';
import { formatDateTime, relativeTime } from '../lib/format';
import type { ClusterRecord, ProviderKind } from '../lib/types';
import {
  Badge,
  Card,
  ClusterStatusBadge,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Modal,
  PageHeader,
  StatCard,
} from '../components/common';

interface ClusterForm {
  name: string;
  provider: ProviderKind;
  apiUrl: string;
  tokenId: string;
  tokenSecret: string;
  verifyTls: boolean;
  enabled: boolean;
}

const EMPTY: ClusterForm = {
  name: '',
  provider: 'pve',
  apiUrl: 'https://pve.example.com:8006',
  tokenId: '',
  tokenSecret: '',
  verifyTls: true,
  enabled: true,
};

interface SyncReport {
  clusterId: string;
  name: string;
  status: string;
  nodes: number;
  guests: number;
  unexpectedStops: number;
  durationMs: number;
  error: string | null;
}

/**
 * 集群设置：接入多个 PVE 集群、测试连通性、手动同步与启停。
 * 演示环境内置 Mock Provider，可在无 PVE 的条件下体验完整流程。
 */
export function ClustersPage() {
  const { can } = useAuth();
  const clusters = useApiQuery<ClusterRecord[]>('/clusters');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ClusterRecord | null>(null);
  const [form, setForm] = useState<ClusterForm>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canManage = can('cluster.manage');

  const openCreate = (): void => {
    setEditing(null);
    setForm(EMPTY);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (cluster: ClusterRecord): void => {
    setEditing(cluster);
    setForm({
      name: cluster.name,
      provider: cluster.provider,
      apiUrl: cluster.apiUrl,
      tokenId: cluster.tokenId,
      tokenSecret: '',
      verifyTls: cluster.verifyTls,
      enabled: cluster.enabled,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await api.patch(`/clusters/${editing.id}`, {
          name: form.name.trim(),
          apiUrl: form.apiUrl.trim(),
          tokenId: form.tokenId.trim(),
          tokenSecret: form.tokenSecret ? form.tokenSecret : undefined,
          verifyTls: form.verifyTls,
          enabled: form.enabled,
        });
      } else {
        await api.post('/clusters', {
          name: form.name.trim(),
          provider: form.provider,
          apiUrl: form.apiUrl.trim(),
          tokenId: form.provider === 'mock' ? '' : form.tokenId.trim(),
          tokenSecret: form.provider === 'mock' ? '' : form.tokenSecret,
          verifyTls: form.verifyTls,
          enabled: form.enabled,
        });
      }
      setModalOpen(false);
      clusters.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (cluster: ClusterRecord): Promise<void> => {
    setBusyId(cluster.id);
    setNotice(null);
    try {
      const result = await api.post<{ ok: boolean; version?: string; nodeCount?: number; error?: string }>(
        `/clusters/${cluster.id}/test`,
      );
      setNotice(
        result.ok
          ? `连接成功：${cluster.name} · 版本 ${result.version ?? '未知'} · ${result.nodeCount ?? 0} 个节点`
          : `连接失败：${result.error ?? '未知错误'}`,
      );
      clusters.reload();
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const syncCluster = async (cluster: ClusterRecord): Promise<void> => {
    setBusyId(cluster.id);
    setNotice(null);
    try {
      const report = await api.post<SyncReport>(`/clusters/${cluster.id}/sync`);
      setNotice(
        `同步完成：${report.guests} 个资源 · ${report.nodes} 个节点 · 耗时 ${report.durationMs} ms`,
      );
      clusters.reload();
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (cluster: ClusterRecord): Promise<void> => {
    if (
      !window.confirm(
        `确认移除集群 ${cluster.name}？若本地仍缓存资源记录，将一并丢弃（不影响 PVE 中的真实资源）。`,
      )
    ) {
      return;
    }
    setBusyId(cluster.id);
    try {
      await api.del(`/clusters/${cluster.id}`, { force: 1 });
      clusters.reload();
    } catch (err) {
      window.alert(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  if (clusters.loading && !clusters.data) return <LoadingBlock label="正在加载集群…" />;
  if (clusters.error) return <ErrorBlock message={clusters.error} onRetry={clusters.reload} />;

  const rows = clusters.data ?? [];
  const online = rows.filter((cluster) => cluster.status === 'online').length;

  return (
    <div className="page">
      <PageHeader
        title="集群设置"
        description="接入一个或多个 PVE 集群；API Token 采用 AES-256-GCM 加密存储，前端永远不回显明文。"
        actions={
          canManage ? (
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              接入集群
            </button>
          ) : null
        }
      />

      <div className="stat-grid">
        <StatCard label="集群总数" value={rows.length} hint="支持多集群并行接入" tone="accent" />
        <StatCard label="在线集群" value={online} hint="最近一次探测或同步成功" tone={online === rows.length ? 'success' : 'warning'} />
        <StatCard label="节点总数" value={rows.reduce((sum, item) => sum + item.nodeCount, 0)} hint="来自最近同步" tone="info" />
        <StatCard label="停用集群" value={rows.filter((item) => !item.enabled).length} hint="不参与定时同步" tone="warning" />
      </div>

      {notice ? <div className="chain-banner ok">{notice}</div> : null}

      <Card title="已接入集群" subtitle="同步任务按固定周期拉取资源状态与指标">
        {rows.length === 0 ? (
          <EmptyState
            title="尚未接入集群"
            description="接入 PVE 集群或创建 Mock 演示集群后，即可开始同步资源。"
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>集群</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>版本 / 节点</th>
                  <th>最近同步</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((cluster) => (
                  <tr key={cluster.id}>
                    <td>
                      <strong>{cluster.name}</strong>
                      <div className="cell-sub mono">{cluster.apiUrl}</div>
                      {cluster.lastError ? <div className="cell-sub error-text">{cluster.lastError}</div> : null}
                    </td>
                    <td>
                      <Badge tone={cluster.provider === 'mock' ? 'info' : 'accent'}>
                        {cluster.provider === 'mock' ? 'Mock' : 'PVE'}
                      </Badge>
                      {!cluster.enabled ? <div className="cell-sub">已停用</div> : null}
                    </td>
                    <td>
                      <ClusterStatusBadge status={cluster.status} />
                      <div className="cell-sub">
                        {cluster.tokenSecretSet ? '凭证已配置' : '缺少凭证'}
                        {cluster.verifyTls ? ' · 校验 TLS' : ' · 跳过 TLS'}
                      </div>
                    </td>
                    <td>
                      {cluster.version || '—'}
                      <div className="cell-sub">{cluster.nodeCount} 个节点</div>
                    </td>
                    <td>{cluster.lastSyncAt ? formatDateTime(cluster.lastSyncAt) : '尚未同步'}</td>
                    <td>
                      <div className="row-actions">
                        {canManage ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-mini"
                              disabled={busyId === cluster.id}
                              onClick={() => void testConnection(cluster)}
                            >
                              测试
                            </button>
                            <button
                              type="button"
                              className="btn btn-mini"
                              disabled={busyId === cluster.id || !cluster.enabled}
                              onClick={() => void syncCluster(cluster)}
                            >
                              同步
                            </button>
                            <button
                              type="button"
                              className="btn btn-mini btn-ghost"
                              disabled={busyId === cluster.id}
                              onClick={() => openEdit(cluster)}
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              className="btn btn-mini btn-danger"
                              disabled={busyId === cluster.id}
                              onClick={() => void remove(cluster)}
                            >
                              移除
                            </button>
                          </>
                        ) : (
                          <span className="cell-sub">只读</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="接入说明" subtitle="PVE API Token 的最小权限建议">
        <ul className="hint-list">
          <li>在 PVE 中创建专用 API Token，并仅授予 Datacenter / VM.Audit、VM.PowerMgmt、VM.Allocate 等必要权限。</li>
          <li>地址填写形如 https://pve.example.com:8006；自签证书可关闭 TLS 校验，但生产环境建议配置可信证书。</li>
          <li>令牌标识通常为 user@pve!tokenname，密钥仅在创建或更新时提交一次，之后由服务端加密保存。</li>
          <li>Mock 集群不访问外部网络，用于演示与自动化测试，可安全删除重建。</li>
        </ul>
        <p className="page-footnote">
          最近刷新：{rows.length > 0 ? relativeTime(new Date().toISOString()) : '—'}
        </p>
      </Card>

      <Modal
        open={modalOpen}
        title={editing ? `编辑集群 · ${editing.name}` : '接入 PVE 集群'}
        subtitle="凭证通过 AES-256-GCM 加密后写入本地数据库"
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)}>
              取消
            </button>
            <button type="submit" form="cluster-form" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存集群'}
            </button>
          </>
        }
      >
        <form id="cluster-form" className="form" onSubmit={submit}>
          <div className="form-grid">
            <label>
              集群名称
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                minLength={2}
                maxLength={64}
                required
              />
            </label>
            {!editing ? (
              <label>
                接入类型
                <select
                  value={form.provider}
                  onChange={(event) => setForm({ ...form, provider: event.target.value as ProviderKind })}
                >
                  <option value="pve">PVE · 真实集群</option>
                  <option value="mock">Mock · 演示集群</option>
                </select>
              </label>
            ) : null}
            <label className="span-2">
              API 地址
              <input
                value={form.apiUrl}
                onChange={(event) => setForm({ ...form, apiUrl: event.target.value })}
                placeholder="https://pve.example.com:8006"
                required={form.provider === 'pve'}
              />
              <span className="field-hint">Mock 集群可任意填写，真实集群必须以 http(s):// 开头。</span>
            </label>
            {form.provider === 'pve' ? (
              <>
                <label>
                  Token 标识
                  <input
                    value={form.tokenId}
                    onChange={(event) => setForm({ ...form, tokenId: event.target.value })}
                    placeholder="user@pve!virtgate"
                    required={!editing || !editing.tokenSecretSet}
                  />
                </label>
                <label>
                  Token 密钥
                  <input
                    type="password"
                    value={form.tokenSecret}
                    onChange={(event) => setForm({ ...form, tokenSecret: event.target.value })}
                    placeholder={editing ? '留空表示不修改' : '仅保存一次'}
                    required={!editing}
                  />
                </label>
              </>
            ) : null}
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.verifyTls}
                onChange={(event) => setForm({ ...form, verifyTls: event.target.checked })}
              />
              校验 TLS 证书
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
              />
              启用定时同步
            </label>
          </div>
          {formError ? <div className="form-error">{formError}</div> : null}
        </form>
      </Modal>
    </div>
  );
}
