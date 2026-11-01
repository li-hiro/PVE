import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApiQuery, errorMessage } from '../lib/use-api';
import { formatMemory } from '../lib/format';
import type { DepartmentRecord, PublicUser, QuotaSnapshot } from '../lib/types';
import {
  Badge,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Modal,
  PageHeader,
  ProgressBar,
} from '../components/common';

interface QuotaForm {
  scopeType: 'department' | 'user';
  scopeId: string;
  cpuCores: string;
  memoryMb: string;
  storageGb: string;
  networkMbps: string;
  guestLimit: string;
}

const EMPTY_FORM: QuotaForm = {
  scopeType: 'user',
  scopeId: '',
  cpuCores: '',
  memoryMb: '',
  storageGb: '',
  networkMbps: '',
  guestLimit: '',
};

const toNumberOrNull = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const limitText = (value: number | null, unit: string): string => (value === null ? '不限' : `${value} ${unit}`);

export function QuotasPage() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useApiQuery<QuotaSnapshot[]>('/quotas');
  const users = useApiQuery<PublicUser[]>(can('user.read') ? '/users' : null, { pageSize: 200 });
  const departments = useApiQuery<DepartmentRecord[]>(can('department.read') ? '/departments' : null);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<QuotaForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const openEditor = (snapshot?: QuotaSnapshot): void => {
    if (snapshot) {
      setForm({
        scopeType: snapshot.scopeType,
        scopeId: snapshot.scopeId,
        cpuCores: snapshot.limits.cpuCores?.toString() ?? '',
        memoryMb: snapshot.limits.memoryMb?.toString() ?? '',
        storageGb: snapshot.limits.storageGb?.toString() ?? '',
        networkMbps: snapshot.limits.networkMbps?.toString() ?? '',
        guestLimit: snapshot.limits.guestLimit?.toString() ?? '',
      });
    } else {
      const firstDept = departments.data?.[0];
      setForm({ ...EMPTY_FORM, scopeId: firstDept?.id ?? '' });
    }
    setFormError(null);
    setModalOpen(true);
  };

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!form.scopeId) {
      setFormError('请选择配额作用域');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await api.put('/quotas', {
        scopeType: form.scopeType,
        scopeId: form.scopeId,
        cpuCores: toNumberOrNull(form.cpuCores),
        memoryMb: toNumberOrNull(form.memoryMb),
        storageGb: toNumberOrNull(form.storageGb),
        networkMbps: toNumberOrNull(form.networkMbps),
        guestLimit: toNumberOrNull(form.guestLimit),
      });
      setModalOpen(false);
      reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const removePolicy = async (snapshot: QuotaSnapshot): Promise<void> => {
    if (!window.confirm(`确认删除 ${snapshot.scopeName} 的配额策略？删除后将回退到上级配额或无限制。`)) return;
    try {
      await api.del(`/quotas/${snapshot.scopeType}/${snapshot.scopeId}`);
      reload();
    } catch (err) {
      window.alert(errorMessage(err));
    }
  };

  if (loading && !data) return <LoadingBlock label="正在加载配额策略…" />;
  if (error) return <ErrorBlock message={error} onRetry={reload} />;

  const scopeOptions =
    form.scopeType === 'department'
      ? (departments.data ?? []).map((department) => ({ id: department.id, name: department.name }))
      : (users.data ?? []).map((user) => ({
          id: user.id,
          name: `${user.displayName}（${user.departmentName ?? '无部门'}）`,
        }));

  return (
    <div className="page">
      <PageHeader
        title="配额管理"
        description="CPU、内存、存储、带宽与实例数量五维配额；部门配额可被用户级策略覆盖。"
        actions={
          can('quota.manage') ? (
            <button type="button" className="btn btn-primary" onClick={() => openEditor()}>
              配置配额
            </button>
          ) : null
        }
      />

      <Card title="配额快照" subtitle="用量包含已生效资源与 15 分钟内的创建预占">
        {(data ?? []).length === 0 ? (
          <EmptyState title="暂无配额策略" description="当前所有资源按无限制配额使用。" />
        ) : (
          <div className="quota-table">
            {(data ?? []).map((snapshot) => {
              const usedCpu = snapshot.usage.cpuCores + snapshot.reserved.cpuCores;
              const usedMem = snapshot.usage.memoryMb + snapshot.reserved.memoryMb;
              const usedStorage = snapshot.usage.storageGb + snapshot.reserved.storageGb;
              const usedGuests = snapshot.usage.guestCount + snapshot.reserved.guestCount;
              return (
                <article className="quota-row" key={`${snapshot.scopeType}-${snapshot.scopeId}`}>
                  <div className="quota-row-head">
                    <div>
                      <h2>{snapshot.scopeName}</h2>
                      <span className="cell-sub">
                        {snapshot.scopeType === 'department' ? '部门配额' : '用户配额'}
                        {snapshot.inherited ? ' · 继承自部门' : ''}
                      </span>
                    </div>
                    <div className="row-actions">
                      <Badge tone={snapshot.source === 'none' ? 'muted' : 'accent'}>
                        {snapshot.source === 'user' ? '个人策略' : snapshot.source === 'department' ? '部门策略' : '未配置'}
                      </Badge>
                      {can('quota.manage') ? (
                        <>
                          <button type="button" className="btn btn-mini" onClick={() => openEditor(snapshot)}>
                            编辑
                          </button>
                          {snapshot.source !== 'none' ? (
                            <button
                              type="button"
                              className="btn btn-mini btn-danger"
                              onClick={() => void removePolicy(snapshot)}
                            >
                              删除
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="quota-row-bars">
                    <ProgressBar
                      label={`CPU · ${usedCpu}/${limitText(snapshot.limits.cpuCores, '核')}`}
                      value={usedCpu}
                      max={snapshot.limits.cpuCores}
                    />
                    <ProgressBar
                      label={`内存 · ${formatMemory(usedMem)} / ${formatMemory(snapshot.limits.memoryMb)}`}
                      value={usedMem}
                      max={snapshot.limits.memoryMb}
                    />
                    <ProgressBar
                      label={`存储 · ${usedStorage}/${limitText(snapshot.limits.storageGb, 'GB')}`}
                      value={usedStorage}
                      max={snapshot.limits.storageGb}
                    />
                    <ProgressBar
                      label={`实例 · ${usedGuests}/${limitText(snapshot.limits.guestLimit, '个')}`}
                      value={usedGuests}
                      max={snapshot.limits.guestLimit}
                    />
                  </div>
                  {snapshot.reserved.cpuCores > 0 || snapshot.reserved.guestCount > 0 ? (
                    <p className="cell-sub">
                      当前预占：{snapshot.reserved.cpuCores} 核 · {formatMemory(snapshot.reserved.memoryMb)} ·
                      {' '}
                      {snapshot.reserved.storageGb} GB · {snapshot.reserved.guestCount} 个实例
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        title="配置配额策略"
        subtitle="留空表示该项不限制；保存后立即生效并写入审计链"
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)}>
              取消
            </button>
            <button type="submit" form="quota-form" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存配额'}
            </button>
          </>
        }
      >
        <form id="quota-form" className="form" onSubmit={save}>
          <div className="form-grid">
            <label>
              作用域类型
              <select
                value={form.scopeType}
                onChange={(event) =>
                  setForm({ ...form, scopeType: event.target.value as 'department' | 'user', scopeId: '' })
                }
              >
                <option value="department">部门</option>
                <option value="user">用户</option>
              </select>
            </label>
            <label>
              作用域对象
              <select
                value={form.scopeId}
                onChange={(event) => setForm({ ...form, scopeId: event.target.value })}
                required
              >
                <option value="">请选择</option>
                {scopeOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              CPU 上限（核）
              <input
                type="number"
                min={0}
                value={form.cpuCores}
                onChange={(event) => setForm({ ...form, cpuCores: event.target.value })}
                placeholder="不限制"
              />
            </label>
            <label>
              内存上限（MB）
              <input
                type="number"
                min={0}
                value={form.memoryMb}
                onChange={(event) => setForm({ ...form, memoryMb: event.target.value })}
                placeholder="不限制"
              />
            </label>
            <label>
              存储上限（GB）
              <input
                type="number"
                min={0}
                value={form.storageGb}
                onChange={(event) => setForm({ ...form, storageGb: event.target.value })}
                placeholder="不限制"
              />
            </label>
            <label>
              带宽上限（Mbps）
              <input
                type="number"
                min={0}
                value={form.networkMbps}
                onChange={(event) => setForm({ ...form, networkMbps: event.target.value })}
                placeholder="不限制"
              />
            </label>
            <label>
              实例数量上限（个）
              <input
                type="number"
                min={0}
                value={form.guestLimit}
                onChange={(event) => setForm({ ...form, guestLimit: event.target.value })}
                placeholder="不限制"
              />
            </label>
          </div>
          {formError ? <div className="form-error">{formError}</div> : null}
        </form>
      </Modal>
    </div>
  );
}
