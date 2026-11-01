import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AlertSeverity, AlertStatus, ClusterStatus, GuestStatus, OperationStatus } from '../lib/types';
import { formatPercent } from '../lib/format';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'accent';

export function Badge({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

const GUEST_STATUS: Record<GuestStatus, { label: string; tone: Tone }> = {
  running: { label: '运行中', tone: 'success' },
  stopped: { label: '已停止', tone: 'muted' },
  paused: { label: '已暂停', tone: 'warning' },
  suspended: { label: '已挂起', tone: 'warning' },
  unknown: { label: '未知', tone: 'muted' },
};

export function GuestStatusBadge({ status }: { status: GuestStatus }) {
  const item = GUEST_STATUS[status] ?? GUEST_STATUS.unknown;
  return <Badge tone={item.tone}>{item.label}</Badge>;
}

const CLUSTER_STATUS: Record<ClusterStatus, { label: string; tone: Tone }> = {
  online: { label: '在线', tone: 'success' },
  offline: { label: '离线', tone: 'danger' },
  degraded: { label: '降级', tone: 'warning' },
  unknown: { label: '未知', tone: 'muted' },
};

export function ClusterStatusBadge({ status }: { status: ClusterStatus }) {
  const item = CLUSTER_STATUS[status] ?? CLUSTER_STATUS.unknown;
  return <Badge tone={item.tone}>{item.label}</Badge>;
}

const RESULT: Record<string, { label: string; tone: Tone }> = {
  success: { label: '成功', tone: 'success' },
  failure: { label: '失败', tone: 'danger' },
  denied: { label: '拒绝', tone: 'warning' },
  pending: { label: '执行中', tone: 'info' },
  failed: { label: '失败', tone: 'danger' },
};

export function ResultBadge({ result }: { result: string }) {
  const item = RESULT[result] ?? { label: result, tone: 'muted' as Tone };
  return <Badge tone={item.tone}>{item.label}</Badge>;
}

export function OperationStatusBadge({ status }: { status: OperationStatus }) {
  return <ResultBadge result={status} />;
}

const SEVERITY: Record<AlertSeverity, { label: string; tone: Tone }> = {
  critical: { label: '严重', tone: 'danger' },
  warning: { label: '警告', tone: 'warning' },
  info: { label: '提示', tone: 'info' },
};

export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const item = SEVERITY[severity] ?? SEVERITY.info;
  return <Badge tone={item.tone}>{item.label}</Badge>;
}

const ALERT_STATUS: Record<AlertStatus, { label: string; tone: Tone }> = {
  open: { label: '待处理', tone: 'danger' },
  ack: { label: '已确认', tone: 'warning' },
  closed: { label: '已关闭', tone: 'muted' },
};

export function AlertStatusBadge({ status }: { status: AlertStatus }) {
  const item = ALERT_STATUS[status] ?? ALERT_STATUS.open;
  return <Badge tone={item.tone}>{item.label}</Badge>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description ? <p className="page-subtitle">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {title || actions ? (
        <div className="card-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'accent',
  link,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  link?: string;
}) {
  const content = (
    <>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </>
  );
  return link ? (
    <Link to={link} className={`stat-card tone-${tone}`}>
      {content}
    </Link>
  ) : (
    <div className={`stat-card tone-${tone}`}>{content}</div>
  );
}

export function ProgressBar({
  value,
  max,
  label,
  suffix,
}: {
  value: number;
  max: number | null;
  label?: string;
  suffix?: string;
}) {
  const pct = max === null || max <= 0 ? null : Math.min(100, Math.round((value / max) * 1000) / 10);
  const tone = pct === null ? 'muted' : pct >= 85 ? 'danger' : pct >= 70 ? 'warning' : 'accent';
  return (
    <div className="progress">
      {label ? (
        <div className="progress-label">
          <span>{label}</span>
          <span>
            {pct === null ? '不限' : formatPercent(pct)}
            {suffix ? ` · ${suffix}` : ''}
          </span>
        </div>
      ) : null}
      <div className="progress-track">
        <div className={`progress-fill tone-${tone}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
    </div>
  );
}

export function NodeGauge({ label, value }: { label: string; value: number }) {
  const tone = value >= 85 ? 'danger' : value >= 70 ? 'warning' : 'accent';
  return (
    <div className="node-gauge">
      <div className="progress-label">
        <span>{label}</span>
        <span>{formatPercent(value)}</span>
      </div>
      <div className="progress-track">
        <div className={`progress-fill tone-${tone}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}

export function LoadingBlock({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="state-block loading">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="state-block empty">
      <span className="empty-mark" aria-hidden="true">
        ∅
      </span>
      <strong>{title}</strong>
      {description ? <span>{description}</span> : null}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-block error">
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="btn btn-ghost" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <span>
        共 {total} 条 · 第 {page}/{pages} 页
      </span>
      <div className="pagination-actions">
        <button type="button" className="btn btn-ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          上一页
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

export function Modal({
  open,
  title,
  subtitle,
  children,
  footer,
  onClose,
  size = 'md',
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  size?: 'sm' | 'md' | 'lg';
}) {
  if (!open) return null;
  return (
    <div className="modal-mask" onClick={onClose} role="presentation">
      <div
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}
