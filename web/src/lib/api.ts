import type { PageMeta } from './types';

const TOKEN_KEY = 'virtgate.token';

export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1';

const storage = {
  get(): string | null {
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // 隐私模式下 localStorage 可能不可用，会话仅在内存中保留
    }
  },
  clear(): void {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      // 忽略
    }
  },
};

let memoryToken: string | null = storage.get();

export const getToken = (): string | null => memoryToken;

export function setToken(token: string | null): void {
  memoryToken = token;
  if (token) storage.set(token);
  else storage.clear();
}

export const getApiBase = (): string => API_BASE;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(status: number, code: string, message: string, details?: unknown, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

type QueryParams = RequestOptions['query'];

function buildUrl(path: string, query?: QueryParams): string {
  const base = path.startsWith('http') ? path : `${API_BASE}${path}`;
  if (!query) return base;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `${base}${base.includes('?') ? '&' : '?'}${text}` : base;
}

interface ApiEnvelope<T> {
  data?: T;
  meta?: unknown;
  error?: { code?: string; message?: string; details?: unknown; requestId?: string };
}

interface EnvelopeResult<T> {
  data: T;
  meta: PageMeta | null;
}

/**
 * 底层请求：自动附加 JWT、解析 `{ data, meta }` 包装、归一化错误。
 * 401 时广播事件，由 AuthProvider 清理会话。
 */
async function requestEnvelope<T>(path: string, options: RequestOptions = {}): Promise<EnvelopeResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', '无法连接服务器，请检查网络或后端服务状态');
  }

  const text = await response.text();
  let payload: ApiEnvelope<T> | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('virtgate:unauthorized'));
    }
    throw new ApiError(
      response.status,
      payload?.error?.code ?? `HTTP_${response.status}`,
      payload?.error?.message ?? `请求失败（HTTP ${response.status}）`,
      payload?.error?.details,
      payload?.error?.requestId,
    );
  }

  const meta =
    payload?.meta && typeof payload.meta === 'object' ? (payload.meta as PageMeta) : null;
  const data = payload && payload.data !== undefined ? payload.data : (payload as unknown as T);
  return { data, meta };
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return (await requestEnvelope<T>(path, options)).data;
}

export interface PageResponse<T> {
  items: T[];
  meta: PageMeta;
}

export async function requestPage<T>(path: string, query?: QueryParams, signal?: AbortSignal): Promise<PageResponse<T>> {
  const result = await requestEnvelope<T[]>(path, { query, signal });
  return {
    items: Array.isArray(result.data) ? result.data : [],
    meta: result.meta ?? { page: 1, pageSize: 200, total: Array.isArray(result.data) ? result.data.length : 0 },
  };
}

export const api = {
  get: <T>(path: string, query?: QueryParams, signal?: AbortSignal) => request<T>(path, { query, signal }),
  getPage: <T>(path: string, query?: QueryParams, signal?: AbortSignal) => requestPage<T>(path, query, signal),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T>(path: string, query?: QueryParams) => request<T>(path, { method: 'DELETE', query }),
};

/** 下载导出文件（CSV/JSON），从 Content-Disposition 解析文件名。 */
export async function download(path: string, query?: QueryParams): Promise<void> {
  const token = getToken();
  const response = await fetch(buildUrl(path, query), {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new ApiError(response.status, `HTTP_${response.status}`, '导出失败，请稍后重试');
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = match?.[1] ?? 'virtgate-export';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
