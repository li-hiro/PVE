import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';

interface NavItem {
  to: string;
  label: string;
  permission?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: '运营',
    items: [
      { to: '/', label: '监控概览', permission: 'dashboard.read' },
      { to: '/guests', label: '资源管理', permission: 'guest.read' },
      { to: '/templates', label: '模板中心', permission: 'template.read' },
      { to: '/alerts', label: '告警中心', permission: 'alert.read' },
    ],
  },
  {
    title: '治理',
    items: [
      { to: '/quotas', label: '配额管理', permission: 'quota.read' },
      { to: '/audit', label: '审计中心', permission: 'audit.read' },
      { to: '/users', label: '用户管理', permission: 'user.read' },
      { to: '/roles', label: '角色权限', permission: 'role.read' },
      { to: '/departments', label: '部门管理', permission: 'department.read' },
    ],
  },
  {
    title: '基础设施',
    items: [{ to: '/clusters', label: '集群设置', permission: 'cluster.read' }],
  },
];

export function Layout() {
  const { user, logout, can, bootstrap } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || can(item.permission)),
  })).filter((group) => group.items.length > 0);

  const current = groups
    .flatMap((group) => group.items)
    .sort((left, right) => right.to.length - left.to.length)
    .find((item) => (item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)));

  return (
    <div className={`shell ${mobileOpen ? 'shell-mobile-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">V</span>
          <div>
            <strong>VirtGate</strong>
            <small>PVE 自助运维门户</small>
          </div>
        </div>
        <nav className="nav">
          {groups.map((group) => (
            <div className="nav-group" key={group.title}>
              <span className="nav-title">{group.title}</span>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => setMobileOpen(false)}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          {bootstrap?.demoMode ? <span className="badge badge-accent">演示模式</span> : null}
          <span className="version">v{bootstrap?.version ?? '1.0.0'}</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn menu-toggle"
            aria-label="展开菜单"
            onClick={() => setMobileOpen((value) => !value)}
          >
            ☰
          </button>
          <div className="topbar-title">{current?.label ?? 'VirtGate'}</div>
          <div className="topbar-actions">
            <span className="health-dot" title="服务运行中" />
            <div className="user-menu">
              <button type="button" className="user-chip" onClick={() => setMenuOpen((value) => !value)}>
                <span className="avatar">{(user?.displayName ?? '?').slice(0, 1)}</span>
                <span className="user-meta">
                  <strong>{user?.displayName}</strong>
                  <small>{user?.roleName}</small>
                </span>
              </button>
              {menuOpen ? (
                <div className="user-dropdown" onClick={() => setMenuOpen(false)}>
                  <div className="user-dropdown-head">
                    <strong>{user?.username}</strong>
                    <span>{user?.departmentName ?? '未归属部门'}</span>
                  </div>
                  <NavLink to="/profile" className="dropdown-item">
                    个人设置
                  </NavLink>
                  <button type="button" className="dropdown-item danger" onClick={() => void logout()}>
                    退出登录
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
