import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApiPage, useApiQuery, errorMessage } from '../lib/use-api';
import { formatDateTime } from '../lib/format';
import type { DepartmentRecord, PublicUser, RoleRecord } from '../lib/types';
import {
  Badge,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination,
  StatCard,
} from '../components/common';

const PAGE_SIZE = 20;

interface UserForm {
  username: string;
  displayName: string;
  password: string;
  roleId: string;
  departmentId: string;
  email: string;
  status: 'active' | 'disabled';
}

const EMPTY_USER: UserForm = {
  username: '',
  displayName: '',
  password: '',
  roleId: '',
  departmentId: '',
  email: '',
  status: 'active',
};

export function UsersPage() {
  const { can, user: currentUser } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [roleId, setRoleId] = useState('');

  const users = useApiPage<PublicUser>('/users', {
    page,
    pageSize: PAGE_SIZE,
    q: query || undefined,
    status: status || undefined,
    roleId: roleId || undefined,
  });
  const roles = useApiQuery<RoleRecord[]>('/roles', undefined);
  const departments = useApiQuery<DepartmentRecord[]>(can('department.read') ? '/departments' : null, undefined);

  const [mode, setMode] = useState<'create' | 'edit' | 'password' | null>(null);
  const [editing, setEditing] = useState<PublicUser | null>(null);
  const [form, setForm] = useState<UserForm>(EMPTY_USER);
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const manageableRoles = (roles.data ?? []).filter(
    (role) => currentUser?.roleScope === 'global' || role.scope !== 'global',
  );

  const openCreate = (): void => {
    setMode('create');
    setEditing(null);
    setForm({ ...EMPTY_USER, roleId: manageableRoles[0]?.id ?? '' });
    setError(null);
  };

  const openEdit = (user: PublicUser): void => {
    setMode('edit');
    setEditing(user);
    setForm({
      username: user.username,
      displayName: user.displayName,
      password: '',
      roleId: user.roleId,
      departmentId: user.departmentId ?? '',
      email: user.email,
      status: user.status === 'disabled' ? 'disabled' : 'active',
    });
    setError(null);
  };

  const openPassword = (user: PublicUser): void => {
    setMode('password');
    setEditing(user);
    setNewPassword('');
    setError(null);
  };

  const closeModal = (): void => {
    setMode(null);
    setEditing(null);
    setError(null);
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (mode === 'create') {
        await api.post('/users', {
          username: form.username.trim(),
          displayName: form.displayName.trim(),
          password: form.password,
          roleId: form.roleId,
          departmentId: form.departmentId || null,
          email: form.email.trim() || '',
          status: form.status,
        });
      } else if (mode === 'edit' && editing) {
        await api.patch(`/users/${editing.id}`, {
          displayName: form.displayName.trim(),
          roleId: form.roleId,
          departmentId: form.departmentId || null,
          status: form.status,
          email: form.email.trim() || '',
        });
      } else if (mode === 'password' && editing) {
        await api.post(`/users/${editing.id}/reset-password`, { newPassword });
      }
      closeModal();
      users.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (user: PublicUser): Promise<void> => {
    if (!window.confirm(`确认删除用户 ${user.displayName}（${user.username}）？`)) return;
    try {
      await api.del(`/users/${user.id}`);
      users.reload();
    } catch (err) {
      window.alert(errorMessage(err));
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
        title="用户管理"
        description="用户绑定部门与角色；部门管理员只能管理本部门成员。"
        actions={
          can('user.manage') ? (
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              新建用户
            </button>
          ) : null
        }
      />

      <div className="stat-grid">
        <StatCard label="当前列表" value={users.meta?.total ?? users.items.length} hint="按数据范围过滤" tone="info" />
        <StatCard label="可用角色" value={roles.data?.length ?? '—'} hint="含内置与自定义角色" tone="accent" />
        <StatCard label="部门数量" value={departments.data?.length ?? '—'} hint="组织结构" tone="success" />
        <StatCard
          label="停用账号"
          value={users.items.filter((item) => item.status !== 'active').length}
          hint="本页统计"
          tone="warning"
        />
      </div>

      <Card>
        <div className="toolbar">
          <form className="toolbar-search" onSubmit={applySearch}>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索用户名或姓名" />
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
              aria-label="账号状态"
            >
              <option value="">全部状态</option>
              <option value="active">启用</option>
              <option value="disabled">停用</option>
            </select>
            <select
              value={roleId}
              onChange={(event) => {
                setRoleId(event.target.value);
                setPage(1);
              }}
              aria-label="角色"
            >
              <option value="">全部角色</option>
              {(roles.data ?? []).map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {users.loading && users.items.length === 0 ? <LoadingBlock /> : null}
        {users.error ? <ErrorBlock message={users.error} onRetry={users.reload} /> : null}
        {users.items.length === 0 && !users.loading ? <EmptyState title="没有匹配的用户" /> : null}

        {users.items.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>用户</th>
                    <th>角色</th>
                    <th>部门</th>
                    <th>状态</th>
                    <th>最近登录</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.items.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.displayName}</strong>
                        <div className="cell-sub mono">{user.username}</div>
                      </td>
                      <td>
                        <Badge tone={user.roleScope === 'global' ? 'accent' : 'muted'}>{user.roleName}</Badge>
                        <div className="cell-sub">{user.roleScope}</div>
                      </td>
                      <td>{user.departmentName ?? '—'}</td>
                      <td>
                        <Badge tone={user.status === 'active' ? 'success' : 'warning'}>
                          {user.status === 'active' ? '启用' : '停用'}
                        </Badge>
                      </td>
                      <td>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : '从未登录'}</td>
                      <td>
                        {can('user.manage') ? (
                          <div className="row-actions">
                            <button type="button" className="btn btn-mini btn-ghost" onClick={() => openEdit(user)}>
                              编辑
                            </button>
                            <button type="button" className="btn btn-mini btn-ghost" onClick={() => openPassword(user)}>
                              重置密码
                            </button>
                            {currentUser?.id !== user.id ? (
                              <button type="button" className="btn btn-mini btn-danger" onClick={() => void remove(user)}>
                                删除
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <span className="cell-sub">只读</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {users.meta ? (
              <Pagination page={page} pageSize={PAGE_SIZE} total={users.meta.total} onChange={setPage} />
            ) : null}
          </>
        ) : null}
      </Card>

      <Modal
        open={mode === 'create' || mode === 'edit'}
        title={mode === 'create' ? '新建用户' : `编辑用户 · ${editing?.displayName ?? ''}`}
        subtitle="角色决定权限，部门决定数据范围"
        onClose={closeModal}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeModal}>
              取消
            </button>
            <button type="submit" form="user-form" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        <form id="user-form" className="form" onSubmit={submit}>
          <div className="form-grid">
            {mode === 'create' ? (
              <label>
                用户名
                <input
                  value={form.username}
                  onChange={(event) => setForm({ ...form, username: event.target.value })}
                  pattern="^[a-zA-Z0-9._-]{3,32}$"
                  required
                />
              </label>
            ) : null}
            <label>
              显示名称
              <input
                value={form.displayName}
                onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                required
              />
            </label>
            {mode === 'create' ? (
              <label>
                初始密码
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  minLength={8}
                  required
                />
              </label>
            ) : null}
            <label>
              角色
              <select
                value={form.roleId}
                onChange={(event) => setForm({ ...form, roleId: event.target.value })}
                required
              >
                <option value="">请选择角色</option>
                {manageableRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name} · {role.scope}
                  </option>
                ))}
              </select>
            </label>
            <label>
              部门
              <select
                value={form.departmentId}
                onChange={(event) => setForm({ ...form, departmentId: event.target.value })}
              >
                <option value="">不归属部门</option>
                {(departments.data ?? []).map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              邮箱
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </label>
            <label>
              状态
              <select
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.target.value as 'active' | 'disabled' })}
              >
                <option value="active">启用</option>
                <option value="disabled">停用</option>
              </select>
            </label>
          </div>
          {error ? <div className="form-error">{error}</div> : null}
        </form>
      </Modal>

      <Modal
        open={mode === 'password'}
        title="重置密码"
        subtitle={editing ? `为 ${editing.displayName} 设置新密码` : undefined}
        onClose={closeModal}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeModal}>
              取消
            </button>
            <button type="submit" form="password-form" className="btn btn-primary" disabled={saving}>
              重置
            </button>
          </>
        }
      >
        <form id="password-form" className="form" onSubmit={submit}>
          <label>
            新密码
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              required
            />
            <span className="field-hint">至少 8 位，重置操作会写入审计链。</span>
          </label>
          {error ? <div className="form-error">{error}</div> : null}
        </form>
      </Modal>
    </div>
  );
}
