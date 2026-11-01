import { useState } from 'react';
import { api, download } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApiPage, useApiQuery, errorMessage } from '../lib/use-api';
import { formatDateTime, formatDuration, relativeTime, truncate } from '../lib/format';
import type { AuditEventRecord, AuditStats, OperationRecord, VerifyReport } from '../lib/types';
import {
  Badge,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination,
  ResultBadge,
  StatCard,
} from '../components/common';

const PAGE_SIZE = 25;

type Tab = 'events' | 'operations';

export function AuditPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('events');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState('');
  const [status, setStatus] = useState('');
  const [days, setDays] = useState('7');
  const [detail, setDetail] = useState<AuditEventRecord | null>(null);
  const [verification, setVerification] = useState<VerifyReport | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [exporting, setExporting] = useState(false);

  const stats = useApiQuery<AuditStats>('/audit/stats', { days });
  const events = useApiPage<AuditEventRecord>('/audit/events', {
    page,
    pageSize: PAGE_SIZE,
    q: query || undefined,
    result: result || undefined,
  });
  const operations = useApiPage<OperationRecord>('/operations', {
    page,
    pageSize: PAGE_SIZE,
    q: query || undefined,
    status: status || undefined,
  });

  const applySearch = (event: React.FormEvent): void => {
    event.preventDefault();
    setPage(1);
    setQuery(search.trim());
  };

  const verify = async (): Promise<void> => {
    setVerifying(true);
    setVerifyError(null);
    try {
      const report = await api.post<VerifyReport>('/audit/verify', {});
      setVerification(report);
    } catch (error) {
      setVerifyError(errorMessage(error));
    } finally {
      setVerifying(false);
    }
  };

  const exportReport = async (format: 'csv' | 'json'): Promise<void> => {
    setExporting(true);
    setVerifyError(null);
    try {
      await download('/audit/export', { format, days });
    } catch (error) {
      setVerifyError(errorMessage(error));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="审计中心"
        description="SHA-256 哈希链记录全部运维事件，可检索、校验、回放与导出合规报表。"
        actions={
          <>
            {can('audit.verify') ? (
              <button type="button" className="btn btn-ghost" onClick={() => void verify()} disabled={verifying}>
                {verifying ? '校验中…' : '校验哈希链'}
              </button>
            ) : null}
            {can('audit.export') ? (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => void exportReport('csv')} disabled={exporting}>
                  导出 CSV
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => void exportReport('json')} disabled={exporting}>
                  导出 JSON
                </button>
              </>
            ) : null}
          </>
        }
      />

      {verification ? (
        <div className={`chain-banner ${verification.valid ? 'ok' : 'broken'}`}>
          <strong>{verification.valid ? '哈希链完整' : '哈希链校验失败'}</strong>
          <span>
            已校验 {verification.checked} 条事件，链头 #{verification.headSeq}
            {verification.brokenAt ? `，首个异常序号 #${verification.brokenAt}` : ''}
          </span>
          <code>{truncate(verification.head, 64)}</code>
        </div>
      ) : null}
      {verifyError ? <div className="form-error">{verifyError}</div> : null}

      <div className="stat-grid">
        <StatCard
          label={`近 ${days} 天事件`}
          value={stats.data?.total ?? '—'}
          hint={`成功 ${stats.data?.success ?? 0} · 失败 ${stats.data?.failure ?? 0}`}
          tone="info"
        />
        <StatCard
          label="权限拒绝"
          value={stats.data?.denied ?? 0}
          hint="被拒绝的操作同样留痕"
          tone={'danger'}
        />
        <StatCard
          label="操作类型"
          value={stats.data?.byAction.length ?? 0}
          hint={stats.data?.byAction[0] ? `最多：${stats.data.byAction[0].action}` : '暂无'}
          tone="accent"
        />
        <StatCard
          label="活跃操作人"
          value={stats.data?.byActor.length ?? 0}
          hint={stats.data?.byActor[0] ? `最活跃：${stats.data.byActor[0].actorName}` : '暂无'}
          tone="success"
        />
      </div>

      <Card>
        <div className="tabs">
          <button
            type="button"
            className={`tab ${tab === 'events' ? 'active' : ''}`}
            onClick={() => {
              setTab('events');
              setPage(1);
            }}
          >
            审计事件
          </button>
          <button
            type="button"
            className={`tab ${tab === 'operations' ? 'active' : ''}`}
            onClick={() => {
              setTab('operations');
              setPage(1);
            }}
          >
            操作流水
          </button>
          <div className="tab-actions">
            <select value={days} onChange={(event) => setDays(event.target.value)} aria-label="统计时间范围">
              <option value="1">近 1 天</option>
              <option value="7">近 7 天</option>
              <option value="30">近 30 天</option>
            </select>
          </div>
        </div>

        <div className="toolbar">
          <form className="toolbar-search" onSubmit={applySearch}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={tab === 'events' ? '搜索操作人、动作、目标或详情' : '搜索操作人、资源或动作'}
            />
            <button type="submit" className="btn btn-ghost">
              搜索
            </button>
          </form>
          {tab === 'events' ? (
            <select
              value={result}
              onChange={(event) => {
                setResult(event.target.value);
                setPage(1);
              }}
              aria-label="结果筛选"
            >
              <option value="">全部结果</option>
              <option value="success">成功</option>
              <option value="failure">失败</option>
              <option value="denied">拒绝</option>
            </select>
          ) : (
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              aria-label="状态筛选"
            >
              <option value="">全部状态</option>
              <option value="success">成功</option>
              <option value="failed">失败</option>
              <option value="denied">拒绝</option>
              <option value="pending">执行中</option>
            </select>
          )}
        </div>

        {tab === 'events' ? (
          <>
            {events.loading && events.items.length === 0 ? <LoadingBlock /> : null}
            {events.error ? <ErrorBlock message={events.error} onRetry={events.reload} /> : null}
            {events.items.length === 0 && !events.loading ? <EmptyState title="没有匹配的审计事件" /> : null}
            {events.items.length > 0 ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>时间</th>
                      <th>操作人</th>
                      <th>动作</th>
                      <th>目标</th>
                      <th>结果</th>
                      <th>来源 IP</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {events.items.map((event) => (
                      <tr key={event.id}>
                        <td className="mono">{event.seq}</td>
                        <td>{formatDateTime(event.ts)}</td>
                        <td>{event.actorName}</td>
                        <td className="mono">{event.action}</td>
                        <td>
                          {event.targetType}
                          <div className="cell-sub mono">{truncate(event.targetId, 40)}</div>
                        </td>
                        <td>
                          <ResultBadge result={event.result} />
                        </td>
                        <td className="mono">{event.ip || '—'}</td>
                        <td>
                          <button type="button" className="btn btn-mini btn-ghost" onClick={() => setDetail(event)}>
                            详情
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {events.meta ? (
              <Pagination page={page} pageSize={PAGE_SIZE} total={events.meta.total} onChange={setPage} />
            ) : null}
          </>
        ) : (
          <>
            {operations.loading && operations.items.length === 0 ? <LoadingBlock /> : null}
            {operations.error ? <ErrorBlock message={operations.error} onRetry={operations.reload} /> : null}
            {operations.items.length === 0 && !operations.loading ? <EmptyState title="没有匹配的操作流水" /> : null}
            {operations.items.length > 0 ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>操作人</th>
                      <th>资源</th>
                      <th>动作</th>
                      <th>状态</th>
                      <th>耗时</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operations.items.map((operation) => (
                      <tr key={operation.id}>
                        <td>{formatDateTime(operation.startedAt)}</td>
                        <td>{operation.actorName}</td>
                        <td>
                          {operation.guestName || '—'}
                          <div className="cell-sub">VMID {operation.vmid ?? '—'}</div>
                        </td>
                        <td className="mono">{operation.action}</td>
                        <td>
                          <ResultBadge result={operation.status} />
                        </td>
                        <td>{formatDuration(operation.durationMs)}</td>
                        <td className="cell-message">{operation.message || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {operations.meta ? (
              <Pagination page={page} pageSize={PAGE_SIZE} total={operations.meta.total} onChange={setPage} />
            ) : null}
          </>
        )}
      </Card>

      <Card title="高频操作" subtitle={`近 ${days} 天动作分布`}>
        {(stats.data?.byAction ?? []).length === 0 ? (
          <EmptyState title="暂无统计数据" />
        ) : (
          <div className="chip-list">
            {(stats.data?.byAction ?? []).map((item) => (
              <span className="chip" key={item.action}>
                <code>{item.action}</code>
                <Badge tone="accent">{item.count}</Badge>
              </span>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={detail !== null}
        title="审计事件详情"
        subtitle={detail ? `#${detail.seq} · ${relativeTime(detail.ts)}` : undefined}
        onClose={() => setDetail(null)}
        size="lg"
        footer={
          <button type="button" className="btn btn-ghost" onClick={() => setDetail(null)}>
            关闭
          </button>
        }
      >
        {detail ? (
          <div className="detail-stack">
            <dl className="kv-grid">
              <div>
                <span className="kv-label">事件 ID</span>
                <span className="kv-value mono">{detail.id}</span>
              </div>
              <div>
                <span className="kv-label">时间</span>
                <span className="kv-value">{formatDateTime(detail.ts)}</span>
              </div>
              <div>
                <span className="kv-label">操作人</span>
                <span className="kv-value">
                  {detail.actorName}
                  {detail.actorId ? <span className="cell-sub mono">{detail.actorId}</span> : null}
                </span>
              </div>
              <div>
                <span className="kv-label">结果</span>
                <span className="kv-value">
                  <ResultBadge result={detail.result} />
                </span>
              </div>
              <div>
                <span className="kv-label">动作</span>
                <span className="kv-value mono">{detail.action}</span>
              </div>
              <div>
                <span className="kv-label">目标</span>
                <span className="kv-value mono">
                  {detail.targetType}:{detail.targetId}
                </span>
              </div>
              <div>
                <span className="kv-label">来源 IP</span>
                <span className="kv-value mono">{detail.ip || '—'}</span>
              </div>
              <div>
                <span className="kv-label">请求 ID</span>
                <span className="kv-value mono">{detail.requestId || '—'}</span>
              </div>
            </dl>
            <div>
              <h3 className="section-label">载荷详情</h3>
              <pre className="code-block">{JSON.stringify(detail.detail, null, 2)}</pre>
            </div>
            <div>
              <h3 className="section-label">哈希链</h3>
              <div className="hash-row">
                <span>prev</span>
                <code>{detail.prevHash}</code>
              </div>
              <div className="hash-row">
                <span>hash</span>
                <code>{detail.hash}</code>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
