import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError, isAppError } from '../lib/errors.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      // 权限拒绝同样需要留痕：审计链中的 denied 事件是异常行为检测的数据来源
      if (error.code === 'FORBIDDEN' && request.authUser?.id) {
        try {
          app.services.recordAudit(
            {
              actor: request.authUser,
              ip: request.ip,
              userAgent: String(request.headers['user-agent'] ?? ''),
              requestId: request.id,
            },
            {
              action: 'access.denied',
              targetType: 'route',
              targetId: `${request.method} ${request.url.split('?')[0] ?? request.url}`,
              result: 'denied',
              detail: { message: error.message },
            },
          );
        } catch {
          // 审计写入失败不得影响错误响应本身
        }
      }
      return reply.status(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
          requestId: request.id,
        },
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: '参数校验失败',
          details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
          requestId: request.id,
        },
      });
    }
    const statusCode = Number((error as { statusCode?: number }).statusCode ?? 500);
    if (statusCode < 500) {
      return reply.status(statusCode).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error instanceof Error ? error.message : '请求参数不合法',
          requestId: request.id,
        },
      });
    }
    request.log.error({ err: error, requestId: request.id }, '未处理的请求异常');
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: '服务器内部错误，请联系平台管理员',
        requestId: request.id,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `接口不存在：${request.method} ${request.url}`,
        requestId: request.id,
      },
    });
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Request-Id', request.id);
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    if (reply.statusCode >= 500) {
      request.log.error({ statusCode: reply.statusCode, url: request.url }, '请求处理失败');
    }
  });
}

export const appErrorCodes = (error: unknown): string =>
  error instanceof AppError ? error.code : 'INTERNAL_ERROR';
