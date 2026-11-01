import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setToken, getToken } from './api';
import type { BootstrapInfo, PublicUser } from './types';

interface AuthContextValue {
  user: PublicUser | null;
  bootstrap: BootstrapInfo | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<PublicUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
  canAny: (permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const hasPermission = (user: PublicUser | null, permission: string): boolean =>
  !!user && (user.permissions.includes('*') || user.permissions.includes(permission));

/**
 * 全局认证上下文：持有当前用户、能力清单与演示模式元信息。
 * 令牌失效（401）时自动清理本地会话并广播状态。
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    try {
      const me = await api.get<PublicUser>('/auth/me');
      setUser(me);
    } catch {
      setToken(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    api
      .get<BootstrapInfo>('/meta/bootstrap')
      .then((info) => {
        if (active) setBootstrap(info);
      })
      .catch(() => {
        // 元信息失败不阻塞登录流程
      });
    refresh().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    const handler = (): void => {
      setToken(null);
      setUser(null);
    };
    window.addEventListener('virtgate:unauthorized', handler);
    return () => window.removeEventListener('virtgate:unauthorized', handler);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.post<{ token: string; expiresIn: string; user: PublicUser }>('/auth/login', {
      username,
      password,
    });
    setToken(result.token);
    setUser(result.user);
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // 登出接口失败不影响本地清理
    }
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      bootstrap,
      loading,
      login,
      logout,
      refresh,
      can: (permission: string) => hasPermission(user, permission),
      canAny: (permissions: string[]) => permissions.some((item) => hasPermission(user, item)),
    }),
    [user, bootstrap, loading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return context;
}
