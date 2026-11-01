import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, getToken, setToken } from './api';

const envelope = (data: unknown, meta?: unknown): Response =>
  new Response(JSON.stringify({ data, meta }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  setToken(null);
});

describe('api client', () => {
  it('persists JWT in localStorage', () => {
    setToken('token-123');
    expect(getToken()).toBe('token-123');
    expect(window.localStorage.getItem('virtgate.token')).toBe('token-123');
    setToken(null);
    expect(getToken()).toBeNull();
    expect(window.localStorage.getItem('virtgate.token')).toBeNull();
  });

  it('attaches authorization and unwraps the data envelope', async () => {
    const fetchMock = vi.fn(async () =>
      envelope({ id: 'u1', username: 'alice' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    setToken('token-123');

    const user = await api.get<{ id: string; username: string }>('/auth/me');
    expect(user.username).toBe('alice');

    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/me');
    expect((options.headers as Record<string, string>).authorization).toBe('Bearer token-123');
  });

  it('parses pagination meta for list requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envelope([{ id: '1' }], { page: 2, pageSize: 20, total: 45 })));
    const result = await api.getPage('/users', { page: 2, pageSize: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.meta.total).toBe(45);
    expect(result.meta.page).toBe(2);
  });

  it('normalizes API errors and broadcasts unauthorized events', async () => {
    const received: string[] = [];
    const handler = (): void => {
      received.push('unauthorized');
    };
    window.addEventListener('virtgate:unauthorized', handler);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: '登录已过期' } }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    await expect(api.get('/guests')).rejects.toBeInstanceOf(ApiError);
    expect(received).toHaveLength(1);
    window.removeEventListener('virtgate:unauthorized', handler);
  });

  it('maps network failures to a friendly message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    await expect(api.get('/guests')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: '无法连接服务器，请检查网络或后端服务状态',
    });
  });
});
