export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL_ERROR';

/**
 * 统一业务错误：路由层据此转换为稳定的 API 错误响应。
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const isAppError = (value: unknown): value is AppError =>
  value instanceof AppError;

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError('VALIDATION_ERROR', 400, message, details);

export const unauthenticated = (message = '登录状态已失效'): AppError =>
  new AppError('UNAUTHENTICATED', 401, message);

export const forbidden = (message = '没有执行该操作的权限', details?: unknown): AppError =>
  new AppError('FORBIDDEN', 403, message, details);

export const notFound = (message = '资源不存在'): AppError =>
  new AppError('NOT_FOUND', 404, message);

export const conflict = (message: string, details?: unknown): AppError =>
  new AppError('CONFLICT', 409, message, details);

export const quotaExceeded = (message: string, details: unknown): AppError =>
  new AppError('QUOTA_EXCEEDED', 403, message, details);

export const rateLimited = (message = '请求过于频繁，请稍后再试'): AppError =>
  new AppError('RATE_LIMITED', 429, message);

export const upstreamError = (message: string, details?: unknown): AppError =>
  new AppError('UPSTREAM_ERROR', 502, message, details);
