import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../lib/use-api';
import { formatDateTime } from '../lib/format';
import type { PermissionDefinition } from '../lib/types';
import { Badge, Card, PageHeader } from '../components/common';

/**
 * 个人设置：展示当前身份、角色与权限清单，并提供自助修改密码。
 * 密码变更会由后端写入审计链（auth.password.change）。
 */
export function ProfilePage() {
  const { user, bootstrap, refresh } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const catalog = bootstrap?.permissions ?? [];
  const labelOf = (key: string): string =>
    key === '*' ? '全部权限' : catalog.find((item: PermissionDefinition) => item.key === key)?.label ?? key;

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess('密码已更新，变更事件已写入审计链。');
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page page-narrow">
      <PageHeader title="个人设置" description="查看当前账号的身份与权限，并管理登录密码。" />

      <Card title="账号信息">
        <div className="kv-grid">
          <div>
            <span className="kv-label">用户名</span>
            <span className="kv-value mono">{user?.username ?? '—'}</span>
          </div>
          <div>
            <span className="kv-label">显示名称</span>
            <span className="kv-value">{user?.displayName ?? '—'}</span>
          </div>
          <div>
            <span className="kv-label">邮箱</span>
            <span className="kv-value">{user?.email || '未设置'}</span>
          </div>
          <div>
            <span className="kv-label">所属部门</span>
            <span className="kv-value">{user?.departmentName ?? '未归属部门'}</span>
          </div>
          <div>
            <span className="kv-label">角色</span>
            <span className="kv-value">
              <Badge tone={user?.roleScope === 'global' ? 'accent' : 'muted'}>
                {user?.roleName ?? '—'}
              </Badge>
            </span>
          </div>
          <div>
            <span className="kv-label">数据范围</span>
            <span className="kv-value">{user?.roleScope ?? '—'}</span>
          </div>
          <div>
            <span className="kv-label">账号状态</span>
            <span className="kv-value">
              <Badge tone={user?.status === 'active' ? 'success' : 'warning'}>
                {user?.status === 'active' ? '启用' : '停用'}
              </Badge>
            </span>
          </div>
          <div>
            <span className="kv-label">最近登录</span>
            <span className="kv-value">{user?.lastLoginAt ? formatDateTime(user.lastLoginAt) : '—'}</span>
          </div>
        </div>
      </Card>

      <Card title="我的权限" subtitle="权限由角色决定，如需调整请联系平台管理员">
        <div className="chip-list">
          {(user?.permissions ?? []).map((key) => (
            <span className="chip" key={key} title={key}>
              <span>{labelOf(key)}</span>
            </span>
          ))}
          {(user?.permissions ?? []).length === 0 ? (
            <span className="cell-sub">当前账号没有显式权限。</span>
          ) : null}
        </div>
      </Card>

      <Card title="修改密码" subtitle="新密码至少 8 位，且不能与当前密码相同">
        <form className="form" onSubmit={submit}>
          <div className="form-grid">
            <label>
              当前密码
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              新密码
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <label>
              确认新密码
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
          </div>
          {error ? <div className="form-error">{error}</div> : null}
          {success ? <div className="chain-banner ok">{success}</div> : null}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '提交中…' : '更新密码'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
