import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { findUserById } from '../modules/users/user-repo.js';
import { hasPermission } from '../modules/rbac/catalog.js';
import { forbidden, unauthenticated } from '../lib/errors.js';
import type { AuthUser } from '../domain.js';
import type { Db } from '../db/index.js';

export interface AuthPluginOptions {
  db: Db;
}

export async function registerAuth(app: FastifyInstance, options: AuthPluginOptions): Promise<void> {
  const authenticate = async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    try {
      await req.jwtVerify();
    } catch {
      throw unauthenticated();
    }
    const payload = req.user as { sub?: string } | undefined;
    if (!payload?.sub) throw unauthenticated();
    const user = findUserById(options.db, payload.sub);
    if (!user) throw unauthenticated('账号不存在或已被删除');
    if (user.status !== 'active') throw unauthenticated('账号已被停用');
    req.authUser = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      departmentId: user.departmentId,
      roleId: user.roleId,
      roleName: user.roleName,
      roleScope: user.roleScope,
      permissions: user.permissions,
      status: user.status,
    } satisfies AuthUser;
  };

  app.decorateRequest('authUser', null as unknown as AuthUser);
  app.decorate('authenticate', authenticate);
  app.decorate(
    'requirePermission',
    (required: string | string[]) => async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await authenticate(req, reply);
      const list = Array.isArray(required) ? required : [required];
      const allowed = list.some((permission) => hasPermission(req.authUser.permissions, permission));
      if (!allowed) throw forbidden(`缺少所需权限：${list.join(' 或 ')}`);
    },
  );
}
