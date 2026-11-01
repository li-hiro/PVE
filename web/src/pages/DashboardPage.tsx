import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useApiQuery } from '../lib/use-api';
import { formatDateTime, formatMemory, formatPercent, relativeTime } from '../lib/format';
import type { DashboardOverview } from '../lib/types';
import { UsageChart } from '../components/Charts';
import {
  Card,
  EmptyState,
  ErrorBlock,
  GuestStatusBadge,
  LoadingBlock,
  NodeGauge,
  PageHeader,
  ProgressBar,
  ResultBadge,
  SeverityBadge,
  StatCard,
} from '../components/common';

export function DashboardPage() {
  const { user, bootstrap } = useAuth();
  const { data, loading, error, reload } = useApiQuery<DashboardOverview>('/dashboard/overview');

  if (loading && !data) return <LoadingBlock label="正在聚合集群与审计数据…" />;
  if (error) return <ErrorBlock message={error} onRetry={reload} />;
  if (!data) return <EmptyState title="暂无监控数据" description="请先接入集群并执行一次同步。" />;

  const onlineClusters = data.clusters.filter((cluster) => cluster.status === 'online' && cluster.enabled).length;
  const openAlerts = data.alerts.summary.total;

  return (
    <div className="page">
      <PageHeader
        title={`欢迎回来，${user?.displayName ?? ''}`}
        description={
          <span>
            {bootstrap?.demoMode ? '演示集群运行中 · ' : ''}
            数据生成于 {formatDateTime(data.generatedAt)}
          </span>
        }
        actions={
          <button type="button" className="btn btn-ghost" onClick={reload}>
            刷新数据
          </button>
        }
      />

      <div className="stat-grid">
        <StatCard
          label="资源总数"
          value={data.guests.total}
          hint={`${data.guests.running} 台运行中 · ${data.guests.templates} 个模板`}
          tone="accent"
          link="/guests"
        />
        <StatCard
          label="集群在线"
          value={`${onlineClusters}/${data.clusters.length}`}
          hint={data.nodes.length > 0 ? `采集节点 ${data.nodes.length} 个` : '暂无节点数据'}
          tone={onlineClusters === data.clusters.length ? 'success' : 'warning'}
          link="/clusters"
        />
        <StatCard
          label="待处理告警"
          value={openAlerts}
          hint={`严重 ${data.alerts.summary.critical} · 警告 ${data.alerts.summary.warning}`}
          tone={openAlerts > 0 ? 'danger' : 'success'}
          link="/alerts"
        />
        <StatCard
          label="24h 审计事件"
          value={data.audit.summary.total}
          hint={`成功 ${data.audit.summary.success} · 拒绝 ${data.audit.summary.denied}`}
          tone="info"
          link="/audit"
        />
      </div>

      <div className="grid-2">
        <Card title="资源使用趋势" subtitle={data.metrics.label}>
          {data.metrics.points.length > 0 ? (
            <UsageChart points={data.metrics.points} />
          ) : (
            <EmptyState title="暂无指标采样" description="同步任务运行后会生成趋势数据。" />
          )}
        </Card>

        <Card title="节点负载" subtitle="CPU / 内存 / 存储使用率">
          {data.nodes.length === 0 ? (
            <EmptyState title="暂无节点快照" />
          ) : (
            <div className="node-list">
              {data.nodes.map((node) => (
                <div className="node-card" key={`${node.clusterId ?? ''}-${node.node}`}>
                  <div className="node-head">
                    <strong>{node.node}</strong>
                    <span>
                      {node.guestsRunning}/{node.guestsTotal} 运行
                    </span>
                  </div>
                  <NodeGauge label="CPU" value={node.cpuPct} />
                  <NodeGauge label="内存" value={node.memPct} />
                  <NodeGauge label="存储" value={node.diskPct} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card
          title="最新告警"
          subtitle="资源阈值与异常行为"
          actions={<Link to="/alerts" className="link">查看全部</Link>}
        >
          {data.alerts.recent.length === 0 ? (
            <EmptyState title="暂无告警" description="系统运行平稳。" />
          ) : (
            <ul className="event-list">
              {data.alerts.recent.map((alert) => (
                <li key={alert.id} className="event-item">
                  <SeverityBadge severity={alert.severity} />
                  <div className="event-main">
                    <strong>{alert.title}</strong>
                    <span>{alert.message}</span>
                  </div>
                  <span className="event-time">{relativeTime(alert.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="最近审计事件"
          subtitle="所有运维操作均写入哈希链"
          actions={<Link to="/audit" className="link">审计中心</Link>}
        >
          {data.audit.recent.length === 0 ? (
            <EmptyState title="暂无审计事件" />
          ) : (
            <ul className="event-list">
              {data.audit.recent.map((event) => (
                <li key={event.id} className="event-item">
                  <ResultBadge result={event.result} />
                  <div className="event-main">
                    <strong>{event.action}</strong>
                    <span>
                      {event.actorName} · {event.targetType}:{event.targetId}
                    </span>
                  </div>
                  <span className="event-time">{relativeTime(event.ts)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {data.quotas.length > 0 ? (
        <Card title="我的配额" subtitle="预占量包含进行中的创建操作">
          <div className="quota-grid">
            {data.quotas.map((quota) => (
              <div className="quota-card" key={`${quota.scopeType}-${quota.scopeId}`}>
                <div className="quota-head">
                  <strong>{quota.scopeName}</strong>
                  <span className="badge badge-muted">
                    {quota.scopeType === 'department' ? '部门' : '个人'}
                    {quota.inherited ? ' · 继承' : ''}
                  </span>
                </div>
                <ProgressBar
                  label="CPU"
                  value={quota.usage.cpuCores + quota.reserved.cpuCores}
                  max={quota.limits.cpuCores}
                  suffix={`${quota.usage.cpuCores + quota.reserved.cpuCores}/${quota.limits.cpuCores ?? '∞'} 核`}
                />
                <ProgressBar
                  label="内存"
                  value={quota.usage.memoryMb + quota.reserved.memoryMb}
                  max={quota.limits.memoryMb}
                  suffix={formatMemory(quota.usage.memoryMb + quota.reserved.memoryMb)}
                />
                <ProgressBar
                  label="存储"
                  value={quota.usage.storageGb + quota.reserved.storageGb}
                  max={quota.limits.storageGb}
                  suffix={`${quota.usage.storageGb + quota.reserved.storageGb}/${quota.limits.storageGb ?? '∞'} GB`}
                />
                <ProgressBar
                  label="实例"
                  value={quota.usage.guestCount + quota.reserved.guestCount}
                  max={quota.limits.guestLimit}
                  suffix={`${quota.usage.guestCount + quota.reserved.guestCount}/${quota.limits.guestLimit ?? '∞'}`}
                />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="grid-2">
        <Card title="集群状态" subtitle="多集群接入与同步状态">
          {data.clusters.length === 0 ? (
            <EmptyState title="尚未接入集群" description="前往集群设置添加 PVE 集群。" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>集群</th>
                  <th>状态</th>
                  <th>节点</th>
                  <th>最近同步</th>
                </tr>
              </thead>
              <tbody>
                {data.clusters.map((cluster) => (
                  <tr key={cluster.id}>
                    <td>
                      <strong>{cluster.name}</strong>
                      <div className="cell-sub">{cluster.apiUrl}</div>
                    </td>
                    <td>
                      <span className={`badge ${cluster.status === 'online' ? 'badge-success' : 'badge-danger'}`}>
                        {cluster.status === 'online' ? '在线' : cluster.status === 'offline' ? '离线' : cluster.status}
                      </span>
                    </td>
                    <td>{cluster.nodeCount}</td>
                    <td>{cluster.lastSyncAt ? relativeTime(cluster.lastSyncAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="最近操作" subtitle="操作流水与执行结果">
          {data.operations.length === 0 ? (
            <EmptyState title="暂无操作记录" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>资源</th>
                  <th>动作</th>
                  <th>结果</th>
                  <th>耗时</th>
                </tr>
              </thead>
              <tbody>
                {data.operations.map((operation) => (
                  <tr key={operation.id}>
                    <td>
                      <strong>{operation.guestName || '—'}</strong>
                      <div className="cell-sub">{operation.actorName}</div>
                    </td>
                    <td>{operation.action}</td>
                    <td>
                      <ResultBadge result={operation.status} />
                    </td>
                    <td>{operation.durationMs === null ? '—' : `${operation.durationMs} ms`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="dashboard-foot">
        <span>运行中的资源：{data.guests.running} 台</span>
        <span>节点平均 CPU：{formatPercent(average(data.nodes.map((node) => node.cpuPct)))}</span>
        <span>Guest 状态：{data.guests.running} 运行 / {data.guests.stopped} 停止</span>
        <span className="badge badge-muted">哈希链审计已启用</span>
        <GuestStatusBadge status={data.guests.running > 0 ? 'running' : 'stopped'} />
      </div>
    </div>
  );
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
