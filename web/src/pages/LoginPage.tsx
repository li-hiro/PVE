import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../lib/use-api';

const DEMO_ACCOUNTS = [
  { username: 'admin', role: '平台管理员', description: '全部集群与审计权限' },
  { username: 'alice', role: '部门管理员', description: '研发中心资源与成员管理' },
  { username: 'bob', role: '运维操作员', description: '研发中心自助运维' },
  { username: 'carol', role: '只读成员', description: '业务支持部只读视图' },
  { username: 'eve', role: '合规审计员', description: '全组织审计检索与导出' },
];

export function LoginPage() {
  const { user, login, bootstrap } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err, '登录失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="brand brand-large">
          <span className="brand-mark">V</span>
          <div>
            <strong>VirtGate</strong>
            <small>PVE 自助管理与审计门户</small>
          </div>
        </div>
        <h1>让虚拟化资源像云服务一样交付，同时保留完整审计轨迹。</h1>
        <p>
          面向中小企业的 PVE 自助运维门户：部门配额、细粒度 RBAC、防篡改审计链、资源监控与异常告警，
          全部由宽松开源协议组件构建。
        </p>
        <ul className="feature-list">
          <li>多集群接入 · 虚拟机与容器全生命周期自助管理</li>
          <li>部门/用户五维配额预占，杜绝并发超卖</li>
          <li>SHA-256 哈希链审计，可校验、可导出、可回放</li>
          <li>资源阈值与异常行为告警，实时可视化</li>
        </ul>
      </section>

      <section className="login-panel">
        <form onSubmit={submit} className="login-form">
          <h2>登录门户</h2>
          <p className="form-hint">使用组织账号登录，所有操作将进入审计链。</p>
          <label>
            用户名
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              placeholder="例如 bob"
              required
            />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="至少 8 位"
              required
            />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? '登录中…' : '登录'}
          </button>
        </form>

        {bootstrap?.demoMode ? (
          <div className="demo-panel">
            <div className="demo-head">
              <strong>演示环境账号</strong>
              <span>密码均为 Demo@12345（admin 为 Admin@12345）</span>
            </div>
            <div className="demo-accounts">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.username}
                  type="button"
                  className="demo-account"
                  onClick={() => {
                    setUsername(account.username);
                    setPassword(account.username === 'admin' ? 'Admin@12345' : 'Demo@12345');
                    setError(null);
                  }}
                >
                  <strong>{account.username}</strong>
                  <span>{account.role}</span>
                  <small>{account.description}</small>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <footer className="login-footer">
          VirtGate v{bootstrap?.version ?? '1.0.0'} · Apache-2.0 · 完全开源构建
        </footer>
      </section>
    </div>
  );
}
