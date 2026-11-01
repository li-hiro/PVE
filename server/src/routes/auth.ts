import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { badRequest, rateLimited, unauthenticated } from '../lib/errors.js';
import { parseInput, publicUser, requestContext } from '../lib/http.js';
import { findUserById, findUserByUsername, touchLastLogin, updateUser } from '../modules/users/user-repo.js';

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8, '新密码至少 8 位').max(128),
});

interface LoginAttempt {
  count: number;
  resetAt: number;
}

/**
 * 登录失败限流：单进程内存滑动窗口，避免暴力破解压垮 bcrypt 计算。
 * 多实例部署时应结合网关限流使用。
 */
const attempts = new Map<string, LoginAttempt>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 6;

function checkAttempt(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    throw rateLimited('登录尝试过于频繁，请 1 分钟后再试');
  }
}

function clearAttempts(key: string): void {
  attempts.delete(key);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = parseInput(loginSchema, request.body);
    const key = `${request.ip}:${body.username}`;
    checkAttempt(key);

    const user = findUserByUsername(app.services.db, body.username);
    const valid = user ? bcrypt.compareSync(body.password, user.passwordHash) : false;

    if (!user || !valid || user.status !== 'active') {
      const auditEvent = app.services.audit.append({
        actorId: user?.id ?? null,
        actorName: user?.displayName ?? body.username,
        action: 'auth.login',
        targetType: 'user',
        targetId: user?.id ?? body.username,
        result: 'failure',
        ip: request.ip,
        userAgent: String(request.headers['user-agent'] ?? ''),
        requestId: request.id,
        detail: { username: body.username, reason: !user ? 'unknown_user' : !valid ? 'bad_password' : 'disabled' },
      });
      app.services.anomaly.evaluate(auditEvent);
      throw unauthenticated('用户名或密码错误');
    }

    clearAttempts(key);
    touchLastLogin(app.services.db, user.id);
    const token = app.jwt.sign({ sub: user.id }, { expiresIn: app.services.config.jwtExpiresIn });
    const event = app.services.audit.append({
      actorId: user.id,
      actorName: user.displayName,
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
      result: 'success',
      ip: request.ip,
      userAgent: String(request.headers['user-agent'] ?? ''),
      requestId: request.id,
      detail: { username: user.username },
    });
    app.services.anomaly.evaluate(event);

    return {
      data: {
        token,
        expiresIn: app.services.config.jwtExpiresIn,
        user: publicUser(findUserById(app.services.db, user.id) ?? user),
      },
    };
  });

  app.get('/api/v1/auth/me', { preHandler: app.authenticate }, async (request) => {
    const user = findUserById(app.services.db, request.authUser.id);
    if (!user) throw unauthenticated();
    return { data: publicUser(user) };
  });

  app.post('/api/v1/auth/logout', { preHandler: app.authenticate }, async (request) => {
    app.services.recordAudit(requestContext(request), {
      action: 'auth.logout',
      targetType: 'user',
      targetId: request.authUser.id,
      result: 'success',
    });
    return { data: { ok: true } };
  });

  app.post('/api/v1/auth/password', { preHandler: app.authenticate }, async (request) => {
    const body = parseInput(passwordSchema, request.body);
    const user = findUserById(app.services.db, request.authUser.id);
    if (!user) throw unauthenticated();
    if (!bcrypt.compareSync(body.currentPassword, user.passwordHash)) {
      throw badRequest('当前密码不正确');
    }
    if (body.newPassword === body.currentPassword) throw badRequest('新密码不能与当前密码相同');
    updateUser(app.services.db, user.id, { passwordHash: bcrypt.hashSync(body.newPassword, 10) });
    app.services.recordAudit(requestContext(request), {
      action: 'auth.password.change',
      targetType: 'user',
      targetId: user.id,
      result: 'success',
    });
    return { data: { ok: true } };
  });
}
