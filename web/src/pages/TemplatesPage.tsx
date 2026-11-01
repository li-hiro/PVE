import { Link } from 'react-router-dom';
import { useApiQuery } from '../lib/use-api';
import { formatMemory } from '../lib/format';
import type { GuestRecord } from '../lib/types';
import { Badge, EmptyState, ErrorBlock, LoadingBlock, PageHeader } from '../components/common';

export function TemplatesPage() {
  const { data, loading, error, reload } = useApiQuery<GuestRecord[]>('/guests/templates');

  if (loading && !data) return <LoadingBlock label="正在加载模板目录…" />;
  if (error) return <ErrorBlock message={error} onRetry={reload} />;

  return (
    <div className="page">
      <PageHeader
        title="模板中心"
        description="模板对全部具备 template.read 权限的成员可见，可基于模板快速克隆同规格资源。"
        actions={
          <Link to="/guests" className="btn btn-ghost">
            资源列表
          </Link>
        }
      />

      {(data ?? []).length === 0 ? (
        <EmptyState
          title="暂无可用模板"
          description="将一台已停止的资源在详情页“转为模板”，即可出现在此目录。"
        />
      ) : (
        <div className="template-grid">
          {(data ?? []).map((template) => (
            <article className="template-card" key={template.id}>
              <div className="template-head">
                <span className={`type-mark type-${template.type}`}>{template.type.toUpperCase()}</span>
                <Badge tone="info">模板</Badge>
              </div>
              <h2>{template.name}</h2>
              <p className="cell-sub">
                VMID {template.vmid} · {template.clusterName} · {template.node}
              </p>
              <dl className="template-specs">
                <div>
                  <dt>CPU</dt>
                  <dd>{template.cores} 核</dd>
                </div>
                <div>
                  <dt>内存</dt>
                  <dd>{formatMemory(template.memoryMb)}</dd>
                </div>
                <div>
                  <dt>磁盘</dt>
                  <dd>{template.diskGb} GB</dd>
                </div>
                <div>
                  <dt>网络</dt>
                  <dd>{template.networkMbps} Mbps</dd>
                </div>
              </dl>
              <div className="template-tags">
                {template.tags.length === 0 ? <span className="cell-sub">无标签</span> : null}
                {template.tags.map((tag) => (
                  <Badge key={tag} tone="muted">
                    {tag}
                  </Badge>
                ))}
              </div>
              <Link to={`/guests/new?template=${template.vmid}`} className="btn btn-primary btn-block">
                基于此模板创建
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
