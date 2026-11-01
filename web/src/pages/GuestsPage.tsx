import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApiPage, useApiQuery, errorMessage } from '../lib/use-api';
import { formatDateTime, formatMemory, formatUptime } from '../lib/format';
import type { ClusterRecord, GuestRecord } from '../lib/types';
import { ConsoleModal } from '../components/ConsoleModal';
import {
  Card,
  EmptyState,
  ErrorBlock,
  GuestStatusBadge,
  LoadingBlock,
  PageHeader,
  Pagination,
} from '../components/common';

const PAGE_SIZE = 20;

export function GuestsPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [clusterId, setClusterId] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [consoleGuest, setConsoleGuest] = useState<GuestRecord | null>(null);

  const guests = useApiPage<GuestRecord>('/guests', {
    page,
    pageSize: PAGE_SIZE,
    q: query || undefined,
    status: status || undefined,
    type: type || undefined,
    clusterId: clusterId || undefined,
    sort: 'vmid',
  });
  const clusters = useApiQuery<ClusterRecord[]>('/clusters');

  const runPower = async (guest: GuestRecord, action: 'start' | 'stop' | 'reboot'): Promise<void> => {
    if (action !== 'start' && !window.confirm(`确认对 ${guest.name} 执行 ${action === 'stop' ? '关机' : '重启'} 操作？`)) {
      return;
    }
    setBusyId(guest.id);
    setActionError(null);
    try {
      await api.post(`/guests/${guest.id}/actions`, { action });
      guests.reload();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const applySearch = (event: React.FormEvent): void => {
    event.preventDefault();
    setPage(1);
    setQuery(search.trim());
  };

  return (
    <div className="page">
      <PageHeader
        title="资源管理"
        description="自助创建、启停与调整虚拟机/容器，所有操作均按角色数据范围过滤。"
        actions={
          can('guest.create') ? (
            <Link to="/guests/new" className="btn btn-primary">
              新建资源
            </Link>
          ) : null
        }
      />

      <Card>
        <div className="toolbar">
          <form className="toolbar-search" onSubmit={applySearch}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索名称、VMID 或标签"
              aria-label="搜索资源"
            />
            <button type="submit" className="btn btn-ghost">
              搜索
            </button>
          </form>
          <div className="toolbar-filters">
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              aria-label="运行状态"
            >
              <option value="">全部状态</option>
              <option value="running">运行中</option>
              <option value="stopped">已停止</option>
            </select>
            <select
              value={type}
              onChange={(event) => {
                setType(event.target.value);
                setPage(1);
              }}
              aria-label="资源类型"
            >
              <option value="">全部类型</option>
              <option value="qemu">虚拟机 (QEMU)</option>
              <option value="lxc">容器 (LXC)</option>
            </select>
            <select
              value={clusterId}
              onChange={(event) => {
                setClusterId(event.target.value);
                setPage(1);
              }}
              aria-label="集群"
            >
              <option value="">全部集群</option>
              {(clusters.data ?? []).map((cluster) => (
                <option key={cluster.id} value={cluster.id}>
                  {cluster.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {actionError ? <div className="form-error">{actionError}</div> : null}
        {guests.loading && guests.items.length === 0 ? <LoadingBlock /> : null}
        {guests.error ? <ErrorBlock message={guests.error} onRetry={guests.reload} /> : null}

        {guests.error ? null : guests.items.length === 0 && !guests.loading ? (
          <EmptyState title="没有匹配的资源" description="调整筛选条件，或创建第一个自助资源。" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>资源</th>
                    <th>状态</th>
                    <th>类型</th>
                    <th>规格</th>
                    <th>归属</th>
                    <th>运行时长</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(guests.items ?? []).map((guest) => (
                    <tr key={guest.id}>
                      <td>
                        <Link to={`/guests/${guest.id}`} className="cell-link">
                          {guest.name}
                        </Link>
                        <div className="cell-sub">
                          VMID {guest.vmid} · {guest.node} · {guest.clusterName}
                        </div>
                      </td>
                      <td>
                        <GuestStatusBadge status={guest.status} />
                        {guest.template ? <span className="badge badge-info">模板</span> : null}
                      </td>
                      <td>{guest.type.toUpperCase()}</td>
                      <td>
                        {guest.cores} 核 · {formatMemory(guest.memoryMb)}
                        <div className="cell-sub">
                          {guest.diskGb} GB · {guest.networkMbps} Mbps
                        </div>
                      </td>
                      <td>
                        {guest.ownerName ?? '未分配'}
                        <div className="cell-sub">{guest.departmentName ?? '—'}</div>
                      </td>
                      <td>{guest.status === 'running' ? formatUptime(guest.uptimeSec) : '—'}</td>
                      <td>
                        <div className="row-actions">
                          {can('guest.power') && !guest.template ? (
                            guest.status === 'running' ? (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-mini"
                                  disabled={busyId === guest.id}
                                  onClick={() => void runPower(guest, 'reboot')}
                                >
                                  重启
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-mini"
                                  disabled={busyId === guest.id}
                                  onClick={() => void runPower(guest, 'stop')}
                                >
                                  关机
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-mini"
                                disabled={busyId === guest.id}
                                onClick={() => void runPower(guest, 'start')}
                              >
                                启动
                              </button>
                            )
                          ) : null}
                          {can('guest.console') && !guest.template ? (
                            <button type="button" className="btn btn-mini" onClick={() => setConsoleGuest(guest)}>
                              控制台
                            </button>
                          ) : null}
                          <Link to={`/guests/${guest.id}`} className="btn btn-mini btn-ghost">
                            详情
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {guests.meta ? (
              <Pagination page={page} pageSize={PAGE_SIZE} total={guests.meta.total} onChange={setPage} />
            ) : null}
          </>
        )}
      </Card>

      {consoleGuest ? (
        <ConsoleModal
          guest={consoleGuest}
          open={consoleGuest !== null}
          onClose={() => setConsoleGuest(null)}
        />
      ) : null}

      <p className="page-footnote">
        下表仅展示账号授权范围内的资源。最近刷新：{guests.meta ? formatDateTime(new Date().toISOString()) : '—'}
      </p>
    </div>
  );
}
