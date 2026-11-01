import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApiQuery, errorMessage } from '../lib/use-api';
import { formatDateTime, formatDuration, formatMemory, formatUptime, relativeTime } from '../lib/format';
import type { GuestDetail } from '../lib/types';
import { ConsoleModal } from '../components/ConsoleModal';
import {
  Card,
  EmptyState,
  ErrorBlock,
  GuestStatusBadge,
  LoadingBlock,
  Modal,
  PageHeader,
  ProgressBar,
  ResultBadge,
} from '../components/common';

export function GuestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApiQuery<GuestDetail>(id ? `/guests/${id}` : null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [form, setForm] = useState({ name: '', cores: '', memoryMb: '' });

  useEffect(() => {
    if (data) {
      setForm({
        name: data.guest.name,
        cores: String(data.guest.cores),
        memoryMb: String(data.guest.memoryMb),
      });
    }
  }, [data]);

  if (loading && !data) return <LoadingBlock label="正在加载资源详情…" />;
  if (error) return <ErrorBlock message={error} onRetry={reload} />;
  if (!data) return <EmptyState title="资源不存在" description="该资源可能已被删除，或不在你的授权范围内。" />;

  const { guest, operations, timeline, quota } = data;

  const runAction = async (action: string): Promise<void> => {
    if (action !== 'start' && !window.confirm(`确认对 ${guest.name} 执行 ${action}？`)) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/guests/${guest.id}/actions`, { action });
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      await api.patch(`/guests/${guest.id}/config`, {
        name: form.name.trim(),
        cores: Number(form.cores),
        memoryMb: Number(form.memoryMb),
      });
      setConfigOpen(false);
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const removeGuest = async (): Promise<void> => {
    if (!window.confirm(`确认删除 ${guest.name}？该操作不可撤销，将进入审计链。`)) return;
    setBusy(true);
    try {
      await api.del(`/guests/${guest.id}`);
      navigate('/guests', { replace: true });
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(false);
    }
  };

  const markTemplate = async (): Promise<void> => {
    if (!window.confirm('转换为模板后该资源将不再作为普通实例使用，确认继续？')) return;
    setBusy(true);
    try {
      await api.post(`/guests/${guest.id}/template`);
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={guest.name}
        description={
          <span>
            VMID {guest.vmid} · {guest.clusterName} · {guest.node} · {guest.type.toUpperCase()}
          </span>
        }
        actions={
          <Link to="/guests" className="btn btn-ghost">
            返回列表
          </Link>
        }
      />

      {actionError ? <div className="form-error">{actionError}</div> : null}

      <div className="detail-layout">
        <div className="detail-main">
          <Card
            title="运行状态"
            subtitle={`最后同步 ${guest.lastSyncAt ? relativeTime(guest.lastSyncAt) : '未知'}`}
            actions={<GuestStatusBadge status={guest.status} />}
          >
            <div className="kv-grid">
              <div>
                <span className="kv-label">CPU</span>
                <span className="kv-value">{guest.cores} 核</span>
              </div>
              <div>
                <span className="kv-label">内存</span>
                <span className="kv-value">{formatMemory(guest.memoryMb)}</span>
              </div>
              <div>
                <span className="kv-label">磁盘</span>
                <span className="kv-value">{guest.diskGb} GB</span>
              </div>
              <div>
                <span className="kv-label">网络带宽</span>
                <span className="kv-value">{guest.networkMbps} Mbps</span>
              </div>
              <div>
                <span className="kv-label">运行时长</span>
                <span className="kv-value">{formatUptime(guest.uptimeSec)}</span>
              </div>
              <div>
                <span className="kv-label">归属</span>
                <span className="kv-value">
                  {guest.ownerName ?? '未分配'}
                  {guest.departmentName ? ` · ${guest.departmentName}` : ''}
                </span>
              </div>
              <div>
                <span className="kv-label">标签</span>
                <span className="kv-value">{guest.tags.length > 0 ? guest.tags.join(' / ') : '—'}</span>
              </div>
              <div>
                <span className="kv-label">创建时间</span>
                <span className="kv-value">{formatDateTime(guest.createdAt)}</span>
              </div>
            </div>

            <div className="action-bar">
              {can('guest.power') && !guest.template ? (
                guest.status === 'running' ? (
                  <>
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void runAction('shutdown')}>
                      优雅关机
                    </button>
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void runAction('reboot')}>
                      重启
                    </button>
                    {guest.type === 'qemu' ? (
                      <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void runAction('reset')}>
                        强制重置
                      </button>
                    ) : null}
                  </>
                ) : (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void runAction('start')}>
                    启动资源
                  </button>
                )
              ) : null}
              {can('guest.console') && !guest.template ? (
                <button type="button" className="btn btn-ghost" onClick={() => setConsoleOpen(true)}>
                  打开控制台
                </button>
              ) : null}
              {can('guest.config') && !guest.template ? (
                <button type="button" className="btn btn-ghost" onClick={() => setConfigOpen(true)}>
                  调整配置
                </button>
              ) : null}
              {can('template.manage') && !guest.template && guest.status === 'stopped' ? (
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void markTemplate()}>
                  转为模板
                </button>
              ) : null}
              {can('guest.delete') && !guest.template ? (
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void removeGuest()}>
                  删除资源
                </button>
              ) : null}
            </div>
          </Card>

          <Card title="操作流水" subtitle="提供者执行结果与耗时">
            {operations.length === 0 ? (
              <EmptyState title="暂无操作记录" />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>动作</th>
                    <th>状态</th>
                    <th>执行人</th>
                    <th>开始时间</th>
                    <th>耗时</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {operations.map((operation) => (
                    <tr key={operation.id}>
                      <td>{operation.action}</td>
                      <td>
                        <ResultBadge result={operation.status} />
                      </td>
                      <td>{operation.actorName}</td>
                      <td>{formatDateTime(operation.startedAt)}</td>
                      <td>{formatDuration(operation.durationMs)}</td>
                      <td className="cell-message">{operation.message || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="审计轨迹" subtitle="该资源在哈希链中的全部事件">
            {timeline.length === 0 ? (
              <EmptyState title="暂无审计事件" />
            ) : (
              <ul className="timeline">
                {timeline.map((event) => (
                  <li key={event.id} className={`timeline-item result-${event.result}`}>
                    <span className="timeline-time">{formatDateTime(event.ts)}</span>
                    <div className="timeline-main">
                      <strong>{event.action}</strong>
                      <span>
                        {event.actorName} · {event.result} · #{event.seq}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="detail-side">
          <Card title="配额占比" subtitle={quota ? `${quota.scopeName} · ${quota.source === 'user' ? '个人配额' : quota.source === 'department' ? '部门配额' : '未配置'}` : '无配额数据'}>
            {quota ? (
              <div className="quota-card">
                <ProgressBar
                  label="CPU"
                  value={quota.usage.cpuCores + quota.reserved.cpuCores}
                  max={quota.limits.cpuCores}
                  suffix={`${quota.usage.cpuCores}/${quota.limits.cpuCores ?? '∞'} 核`}
                />
                <ProgressBar
                  label="内存"
                  value={quota.usage.memoryMb + quota.reserved.memoryMb}
                  max={quota.limits.memoryMb}
                  suffix={formatMemory(quota.usage.memoryMb)}
                />
                <ProgressBar
                  label="存储"
                  value={quota.usage.storageGb + quota.reserved.storageGb}
                  max={quota.limits.storageGb}
                  suffix={`${quota.usage.storageGb}/${quota.limits.storageGb ?? '∞'} GB`}
                />
                <ProgressBar
                  label="实例"
                  value={quota.usage.guestCount + quota.reserved.guestCount}
                  max={quota.limits.guestLimit}
                  suffix={`${quota.usage.guestCount}/${quota.limits.guestLimit ?? '∞'}`}
                />
              </div>
            ) : (
              <EmptyState title="未查询到配额" description="仅管理员或资源归属人可见配额详情。" />
            )}
          </Card>

          <Card title="资源标识">
            <div className="kv-list">
              <div>
                <span>记录 ID</span>
                <code>{guest.id}</code>
              </div>
              <div>
                <span>集群 ID</span>
                <code>{guest.clusterId}</code>
              </div>
              <div>
                <span>审计目标</span>
                <code>
                  guest:{guest.clusterId}:{guest.vmid}
                </code>
              </div>
            </div>
          </Card>
        </aside>
      </div>

      <ConsoleModal guest={guest} open={consoleOpen} onClose={() => setConsoleOpen(false)} />

      <Modal
        open={configOpen}
        title="调整运行配置"
        subtitle="变更会记录到操作流水与审计链"
        onClose={() => setConfigOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setConfigOpen(false)}>
              取消
            </button>
            <button type="submit" form="config-form" className="btn btn-primary" disabled={busy}>
              保存变更
            </button>
          </>
        }
      >
        <form id="config-form" className="form" onSubmit={saveConfig}>
          <label>
            资源名称
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              pattern="^[a-zA-Z0-9][a-zA-Z0-9._-]{1,62}$"
              required
            />
          </label>
          <label>
            CPU 核数
            <input
              type="number"
              min={1}
              max={64}
              value={form.cores}
              onChange={(event) => setForm({ ...form, cores: event.target.value })}
              required
            />
          </label>
          <label>
            内存（MB）
            <input
              type="number"
              min={128}
              max={1048576}
              value={form.memoryMb}
              onChange={(event) => setForm({ ...form, memoryMb: event.target.value })}
              required
            />
          </label>
        </form>
      </Modal>
    </div>
  );
}
