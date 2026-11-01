import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { decryptSecret } from '../lib/secret-box.js';
import { canAccessGuest } from '../services/access.js';
import { getCluster } from '../modules/clusters/cluster-repo.js';
import {
  deleteConsoleSession,
  findGuestByVm,
  getConsoleSession,
} from '../modules/guests/guest-repo.js';
import { findUserById } from '../modules/users/user-repo.js';
import type { AuthUser } from '../domain.js';

/**
 * 控制台 WebSocket 转发。
 *
 * 浏览器 WebSocket 无法便捷设置 Authorization 头，因此改由服务端先签发一次性
 * 控制台会话，前端以 `?token=<jwt>&session=<sessionId>` 建连。服务端在升级握手后
 * 重新校验账号、资源范围与会话有效期，再以服务端凭证转发到 PVE 的 vncwebsocket。
 *
 * 演示集群（Mock）下提供一个安全的回显终端，便于无 PVE 环境体验与自动化测试。
 */
export async function consoleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/console/:sessionId', { websocket: true }, async (socket, request) => {
    const { sessionId } = request.params as { sessionId: string };
    const query = request.query as Record<string, string | undefined>;
    const close = (code: number, reason: string): void => {
      try {
        socket.close(code, reason);
      } catch {
        // 握手阶段失败时 socket 可能已关闭，忽略
      }
    };

    let user: AuthUser | null = null;
    try {
      const payload = app.jwt.verify<{ sub?: string }>(query.token ?? '');
      if (!payload.sub) throw new Error('token');
      const record = findUserById(app.services.db, payload.sub);
      if (!record || record.status !== 'active') throw new Error('user');
      user = {
        id: record.id,
        username: record.username,
        displayName: record.displayName,
        departmentId: record.departmentId,
        roleId: record.roleId,
        roleName: record.roleName,
        roleScope: record.roleScope,
        permissions: record.permissions,
        status: record.status,
      };
    } catch {
      close(1008, 'UNAUTHENTICATED');
      return;
    }

    const session = getConsoleSession(app.services.db, sessionId);
    if (!session) {
      close(1008, 'SESSION_NOT_FOUND');
      return;
    }
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      app.services.db.prepare('DELETE FROM console_sessions WHERE id = ?').run(sessionId);
      close(1008, 'SESSION_EXPIRED');
      return;
    }
    if (session.actorId !== user.id && user.roleScope !== 'global') {
      close(1008, 'FORBIDDEN');
      return;
    }
    if (!user.permissions.includes('*') && !user.permissions.includes('guest.console')) {
      close(1008, 'FORBIDDEN');
      return;
    }
    const guest = findGuestByVm(app.services.db, session.clusterId, session.vmid);
    if (!guest || !canAccessGuest(user, guest)) {
      close(1008, 'FORBIDDEN');
      return;
    }

    const cluster = getCluster(app.services.db, session.clusterId);
    if (!cluster) {
      close(1011, 'CLUSTER_NOT_FOUND');
      return;
    }
    const provider = app.services.registry.forCluster(cluster);

    // 一次性会话：连接成功后立即失效，防止链接被复制重放
    deleteConsoleSession(app.services.db, sessionId);

    if (cluster.provider === 'mock') {
      socket.send('\r\n\x1b[1;36mVirtGate 演示控制台\x1b[0m\r\n');
      socket.send(`已连接资源 ${guest.name}（VMID ${guest.vmid}，${guest.type.toUpperCase()}）\r\n`);
      socket.send('该会话运行在 Mock 集群上，输入任意字符将原样回显。\r\n\r\n# ');
      socket.on('message', (data) => {
        socket.send(String(data));
      });
      return;
    }

    let ticket = '';
    try {
      ticket = decryptSecret(session.ticketEnc, app.services.config.encryptionKey);
    } catch {
      close(1011, 'TICKET_INVALID');
      return;
    }

    const upstream = new WebSocket(provider.webSocketUrl(session.upstreamPath), {
      headers: provider.webSocketHeaders(),
      rejectUnauthorized: cluster.verifyTls,
    });

    upstream.on('open', () => {
      // LXC termproxy 要求首帧携带 “用户:票据” 完成鉴权
      if (session.kind === 'term' && session.ticketUser) {
        upstream.send(`${session.ticketUser}:${ticket}`);
      }
    });
    upstream.on('message', (data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data as Buffer);
    });
    upstream.on('close', () => {
      close(1000, 'UPSTREAM_CLOSED');
    });
    upstream.on('error', () => {
      close(1011, 'UPSTREAM_ERROR');
    });
    socket.on('message', (data) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data as Buffer);
    });
    socket.on('close', () => {
      upstream.close();
    });
  });
}
