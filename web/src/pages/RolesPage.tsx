import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApiQuery, errorMessage } from '../lib/use-api';
import type { PermissionDefinition, RoleRecord, RoleScope } from '../lib/types';
import {
  Badge,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Modal,
  PageHeader,
} from '../components/common';

interface RoleForm {
  name: string;
  description: string;
  scope: RoleScope;
  permissions: string[];
}

const EMPTY: RoleForm = { name: '', description: '', scope: 'department', permissions: [] };

export function RolesPage() {
  const { can } = useAuth();
  const roles = useApiQuery<RoleRecord[]>('/roles');
  const permissions = useApiQuery<PermissionDefinition[]>('/permissions');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRecord | null>(null);
  const [form, setForm] = useState<RoleForm>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const catalog = permissions.data ?? [];
  const groups = useMemo(() => {
    const map = new Map<string, PermissionDefinition[]>();
    for (const item of catalog) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return [...map.entries()];
  }, [catalog]);

  const labelOf = (key: string): string =>
    key === '*' ? '全部权限' : catalog.find((item) => item.key === key)?.label ?? key;

  const openCreate = (): void => {
    setEditing(null);
    setForm(EMPTY);
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (role: RoleRecord): void => {
    setEditing(role);
    setForm({
      name: role.name,
      description: role.description,
      scope: role.scope,
      permissions: [...role.permissions],
    });
    setError(null);
    setModalOpen(true);
  };

  const togglePermission = (key: string): void => {
    setForm((current) => ({
      ...current,
      permissions: current.permissions.includes(key)
        ? current.permissions.filter((item) => item !== key)
        : [...current.permissions, key],
    }));
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (form.permissions.length === 0) {
      setError('至少选择一项权限');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await api.patch(`/roles/${editing.id}`, {
          name: form.name,
          description: form.description,
          scope: form.scope,
          permissions: form.permissions,
        });
      } else {
        await api.post('/roles', {
          name: form.name,
          description: form.description,
          scope: form.scope,
          permissions: form.permissions,
        });
      }
      setModalOpen(false);
      roles.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (role: RoleRecord): Promise<void> => {
    if (!window.confirm(`确认删除角色 ${role.name}？`)) return;
    try {
      await api.del(`/roles/${role.id}`);
      roles.reload();
    } catch (err) {
      window.alert(errorMessage(err));
    }
  };

  if (roles.loading && !roles.data) return <LoadingBlock label="正在加载角色…" />;
  if (roles.error) return <ErrorBlock message={roles.error} onRetry={roles.reload} />;

  return (
    <div className="page">
      <PageHeader
        title="角色权限"
        description="角色由作用域（全局 / 部门 / 本人）与权限集合组成；内置角色不可修改。"
        actions={
          can('role.manage') ? (
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              新建角色
            </button>
          ) : null
        }
      />

      <div className="role-grid">
        {(roles.data ?? []).map((role) => (
          <article className="role-card" key={role.id}>
            <div className="role-head">
              <div>
                <h2>{role.name}</h2>
                <p className="cell-sub">{role.description || '无描述'}</p>
              </div>
              <div className="role-badges">
                <Badge tone="accent">{role.scope}</Badge>
                {role.builtin ? <Badge tone="muted">内置</Badge> : <Badge tone="info">自定义</Badge>}
              </div>
            </div>
            <div className="role-meta">
              <span>
                权限 {role.permissions.includes('*') ? '全部' : role.permissions.length} 项
              </span>
              {role.userCount !== undefined ? <span>关联用户 {role.userCount}</span> : null}
            </div>
            <div className="chip-list">
              {role.permissions.slice(0, 12).map((key) => (
                <span className="chip" key={key}>
                  {labelOf(key)}
                </span>
              ))}
              {role.permissions.length > 12 ? (
                <span className="chip">+{role.permissions.length - 12}</span>
              ) : null}
            </div>
            {can('role.manage') && !role.builtin ? (
              <div className="row-actions">
                <button type="button" className="btn btn-mini btn-ghost" onClick={() => openEdit(role)}>
                  编辑
                </button>
                <button type="button" className="btn btn-mini btn-danger" onClick={() => void remove(role)}>
                  删除
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {(roles.data ?? []).length === 0 ? <EmptyState title="暂无角色" /> : null}

      <Card title="权限目录" subtitle="后端与前端共享同一权限清单">
        {(permissions.data ?? []).length === 0 ? (
          <EmptyState title="无法读取权限目录" />
        ) : (
          <div className="permission-groups">
            {groups.map(([group, items]) => (
              <div className="permission-group" key={group}>
                <h3>{group}</h3>
                <div className="chip-list">
                  {items.map((item) => (
                    <span className="chip" key={item.key} title={item.description}>
                      <code>{item.key}</code>
                      <span>{item.label}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        title={editing ? `编辑角色 · ${editing.name}` : '新建角色'}
        subtitle="权限变更会立即对关联用户生效，并记录审计事件"
        onClose={() => setModalOpen(false)}
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)}>
              取消
            </button>
            <button type="submit" form="role-form" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存角色'}
            </button>
          </>
        }
      >
        <form id="role-form" className="form" onSubmit={submit}>
          <div className="form-grid">
            <label>
              角色标识
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                pattern="^[a-zA-Z0-9_-]{2,32}$"
                required
              />
            </label>
            <label>
              作用域
              <select value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value as RoleScope })}>
                <option value="global">global · 全组织</option>
                <option value="department">department · 本部门</option>
                <option value="own">own · 仅本人资源</option>
              </select>
            </label>
            <label className="span-2">
              描述
              <input
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </label>
          </div>

          <div className="permission-picker">
            {groups.map(([group, items]) => (
              <div className="permission-group" key={group}>
                <h3>{group}</h3>
                <div className="checkbox-grid">
                  {items.map((item) => (
                    <label className="checkbox-row" key={item.key} title={item.description}>
                      <input
                        type="checkbox"
                        checked={form.permissions.includes(item.key)}
                        onChange={() => togglePermission(item.key)}
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {error ? <div className="form-error">{error}</div> : null}
        </form>
      </Modal>
    </div>
  );
}
