import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApiPage, useApiQuery, errorMessage } from '../lib/use-api';
import { formatDateTime, relativeTime } from '../lib/format';
import type { AlertRecord, AlertSummary, PageMeta } from '../lib/types';
import {
  AlertStatusBadge,
  Badge,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Pagination,
  SeverityBadge,
  StatCard,
} from '../components/common';

const PAGE_SIZE = 20;

const CATEGORY_LABEL: Record<AlertRecord['category'], string> = {
  anomaly: '异常行为',
  resource: '资源阈值',
  availability: '可用性',
  operation: '操作异常',
};

export function AlertsPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const summary = useApiQuery<AlertSummary>('/alerts/summary');
  const alerts = useApiPage<AlertRecord>('/alerts', {
    page,
    pageSize: PAGE_SIZE,
    status: status || undefined,
    severity: severity || undefined,
    category: category || undefined,
    q: query || undefined,
  });

  const acknowledge = async (alert: AlertRecord): Promise<void> => {
    setBusyId(alert.id);
    setError(null);
    try {
      await api.post(`/alerts/${alert.id}/ack`);
      alerts.reload();
      summary.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const applySearch = (event: React.FormEvent): void => {
    event.preventDefault();
    setPage(1);
    setQuery(search.trim());
  };

  const meta: PageMeta | null = alerts.meta;

  return (
    <div className="page">
      <PageHeader
        title="告警中心"
        description="资源阈值、可用性与异常行为告警统一汇聚；确认操作会写入审计链。"
        actions={
          <button type="button" className="btn btn-ghost" onClick={() => { alerts.reload(); summary.reload(); }}>
            刷新
          </button>
        }
      />

      <div className="stat-grid">
        <StatCard label="待处理告警" value={summary.data?.total ?? '—'} hint="open 状态" tone="danger" />
        <StatCard label="严重" value={summary.data?.critical ?? '—'} hint="需立即处置" tone="danger" />
        <StatCard label="警告" value={summary.data?.warning ?? '—'} hint="建议尽快复核" tone="warning" />
        <StatCard label="提示" value={summary.data?.info ?? '—'} hint="非工作时段等低风险事件" tone="info" />
      </div>

      <Card>
        <div className="toolbar">
          <form className="toolbar-search" onSubmit={applySearch}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索标题或告警内容"
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
              aria-label="告警状态"
            >
              <option value="">全部状态</option>
              <option value="open">待处理</option>
              <option value="ack">已确认</option>
              <option value="closed">已关闭</option>
            </select>
            <select
              value={severity}
              onChange={(event) => {
                setSeverity(event.target.value);
                setPage(1);
              }}
              aria-label="严重级别"
            >
              <option value="">全部级别</option>
              <option value="critical">严重</option>
              <option value="warning">警告</option>
              <option value="info">提示</option>
            </select>
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
              }}
              aria-label="告警类别"
            >
              <option value="">全部类别</option>
              <option value="resource">资源阈值</option>
              <option value="anomaly">异常行为</option>
              <option value="availability">可用性</option>
              <option value="operation">操作异常</option>
            </select>
          </div>
        </div>

        {error ? <div className="form-error">{error}</div> : null}
        {alerts.loading && alerts.items.length === 0 ? <LoadingBlock /> : null}
        {alerts.error ? <ErrorBlock message={alerts.error} onRetry={alerts.reload} /> : null}
        {alerts.items.length === 0 && !alerts.loading ? (
          <EmptyState title="没有匹配的告警" description="系统运行平稳，或当前筛选条件下无结果。" />
        ) : (
          <div className="alert-list">
            {alerts.items.map((alert) => (
              <article className={`alert-item severity-${alert.severity}`} key={alert.id}>
                <div className="alert-head">
                  <SeverityBadge severity={alert.severity} />
                  <Badge tone="muted">{CATEGORY_LABEL[alert.category]}</Badge>
                  <AlertStatusBadge status={alert.status} />
                  <span className="alert-time">{relativeTime(alert.createdAt)}</span>
                </div>
                <h2>{alert.title}</h2>
                <p>{alert.message}</p>
                <div className="alert-foot">
                  <span className="cell-sub">
                    规则 <code>{alert.rule}</code> · 目标 {alert.targetType}:{alert.targetId} · 触发于{' '}
                    {formatDateTime(alert.createdAt)}
                    {alert.ackedAt ? ` · 确认于 ${formatDateTime(alert.ackedAt)}` : ''}
                  </span>
                  {can('alert.manage') && alert.status === 'open' ? (
                    <button
                      type="button"
                      className="btn btn-mini"
                      disabled={busyId === alert.id}
                      onClick={() => void acknowledge(alert)}
                    >
                      {busyId === alert.id ? '处理中…' : '确认告警'}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}

        {meta ? <Pagination page={page} pageSize={PAGE_SIZE} total={meta.total} onChange={setPage} /> : null}
      </Card>
    </div>
  );
}
