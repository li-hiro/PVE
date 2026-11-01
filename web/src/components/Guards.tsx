import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { EmptyState } from './common';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="boot-screen">
        <span className="spinner" aria-hidden="true" />
        <span>正在加载 VirtGate…</span>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAuth();
  const location = useLocation();
  if (!can(permission)) {
    return (
      <div className="permission-denied">
        <EmptyState
          title="没有访问权限"
          description={`当前账号缺少 ${permission} 权限，无法访问 ${location.pathname}。如需访问请联系平台管理员。`}
        />
        <Link to="/" className="btn btn-primary">
          返回监控概览
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}
