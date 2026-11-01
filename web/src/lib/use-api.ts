import { useEffect, useState } from 'react';
import { ApiError, api } from './api';
import type { PageMeta } from './types';

export interface QueryResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export interface PageQueryResult<T> {
  items: T[];
  meta: PageMeta | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function errorMessage(error: unknown, fallback = '请求失败'): string {
  if (error instanceof ApiError) {
    const details = error.details;
    if (details && typeof details === 'object' && 'dimensions' in details) {
      const dimensions = (details as { dimensions?: Array<{ label: string; limit: number; requested: number }> })
        .dimensions;
      if (Array.isArray(dimensions) && dimensions.length > 0) {
        const text = dimensions.map((item) => `${item.label}（上限 ${item.limit}，本次请求 ${item.requested}）`).join('、');
        return `${error.message}：${text}`;
      }
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

type QueryParams = Record<string, string | number | boolean | undefined | null>;

/**
 * 简单的 GET 数据钩子：统一处理加载态、错误态与手动刷新。
 * query 以序列化结果作为依赖，避免对象字面量导致无限请求。
 */
export function useApiQuery<T>(path: string | null, query?: QueryParams): QueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify(query ?? {});

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .get<T>(path, query, controller.signal)
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(errorMessage(err));
        setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, nonce]);

  return {
    data,
    loading,
    error,
    reload: () => setNonce((value) => value + 1),
  };
}

/** 分页列表钩子：保留 meta 信息，供分页组件展示总数。 */
export function useApiPage<T>(path: string, query: QueryParams): PageQueryResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify(query);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .getPage<T>(path, query, controller.signal)
      .then((result) => {
        setItems(result.items);
        setMeta(result.meta);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(errorMessage(err));
        setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, nonce]);

  return {
    items,
    meta,
    loading,
    error,
    reload: () => setNonce((value) => value + 1),
  };
}
