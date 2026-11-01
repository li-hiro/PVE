import { Link } from 'react-router-dom';
import { EmptyState } from '../components/common';

export function NotFoundPage() {
  return (
    <div className="permission-denied">
      <EmptyState title="页面不存在" description="你访问的地址可能已被移动或删除。" />
      <Link to="/" className="btn btn-primary">
        返回监控概览
      </Link>
    </div>
  );
}
