import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { pageParams, parseInput, requestContext } from '../lib/http.js';
import type { PowerAction } from '../pve/types.js';
import type { GuestRecord } from '../domain.js';
import { canAccessGuest, guestScope } from '../services/access.js';
import { getGuestById, listGuests, listTemplates } from '../modules/guests/guest-repo.js';
import { listOperations } from '../modules/operations/operation-repo.js';
import { findUserById } from '../modules/users/user-repo.js';

const guestCreateSchema = z.object({
  clusterId: z.string().min(1),
  type: z.enum(['qemu', 'lxc']),
  name: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,62}$/, '资源名称需以字母或数字开头，2-63 位'),
  node: z.string().trim().min(1),
  cores: z.number().int().min(1).max(64),
  memoryMb: z.number().int().min(128).max(1_048_576),
  diskGb: z.number().int().min(1).max(4096),
  storage: z.string().trim().min(1).max(64),
  templateId: z.number().int().min(100).nullable().optional().default(null),
  templateNode: z.string().trim().min(1).nullable().optional().default(null),
  iso: z.string().trim().max(200).nullable().optional().default(null),
  networkBridge: z.string().trim().min(1).max(64).default('vmbr0'),
  rateMbps: z.number().int().min(0).max(100000).optional().default(0),
  startOnCreate: z.boolean().optional().default(false),
  ownerId: z.string().min(1).nullable().optional().default(null),
});

const powerSchema = z.object({
  action: z.enum(['start', 'stop', 'shutdown', 'reboot', 'reset', 'suspend']),
});

const configSchema = z.object({
  cores: z.number().int().min(1).max(64).optional(),
  memoryMb: z.number().int().min(128).max(1_048_576).optional(),
  name: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,62}$/, '资源名称需以字母或数字开头，2-63 位')
    .optional(),
});

function loadGuest(app: FastifyInstance, id: string): GuestRecord {
  const guest = getGuestById(app.services.db, id);
  if (!guest) throw notFound('资源不存在');
  return guest;
}

export async function guestRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/guests', { preHandler: app.requirePermission('guest.read') }, async (request) => {
    const { page, pageSize } = pageParams(request.query);
    const query = request.query as Record<string, string | undefined>;
    const scope = guestScope(request.authUser);
    const templateParam = query.template;
    const result = listGuests(app.services.db, {
      clusterId: query.clusterId,
      status: query.status,
      type: query.type === 'qemu' || query.type === 'lxc' ? query.type : undefined,
      template: templateParam === undefined ? undefined : templateParam === '1' || templateParam === 'true',
      departmentId: query.departmentId,
      ownerId: query.ownerId,
      query: query.q,
      scopeSql: scope?.sql,
      scopeParams: scope?.params,
      page,
      pageSize,
      sort: query.sort === 'name' ? 'name' : query.sort === 'updated' ? 'updated' : 'vmid',
    });
    return { data: result.items, meta: { page, pageSize, total: result.total } };
  });

  app.get('/api/v1/guests/templates', { preHandler: app.requirePermission('template.read') }, async () => ({
    data: listTemplates(app.services.db),
  }));

  app.get('/api/v1/guests/:id', { preHandler: app.requirePermission('guest.read') }, async (request) => {
    const { id } = request.params as { id: string };
    const guest = loadGuest(app, id);
    if (!canAccessGuest(request.authUser, guest)) throw forbidden('该资源不在你的授权范围内');
    const operations = listOperations(app.services.db, {
      clusterId: guest.clusterId,
      vmid: guest.vmid,
      page: 1,
      pageSize: 12,
    });
    const timeline = app.services.audit
      .timeline('guest', `${guest.clusterId}:${guest.vmid}`)
      .slice(-20);
    const canReadQuota = request.authUser.permissions.includes('quota.read') || request.authUser.permissions.includes('*');
    const owner = guest.ownerId ? findUserById(app.services.db, guest.ownerId) : null;
    const quota =
      canReadQuota && owner
        ? app.services.quotas.snapshot('user', owner.id, owner.displayName)
        : null;
    return {
      data: {
        guest,
        operations: operations.items,
        timeline,
        quota,
      },
    };
  });

  app.get('/api/v1/guests/:id/timeline', { preHandler: app.requirePermission('audit.read') }, async (request) => {
    const { id } = request.params as { id: string };
    const guest = loadGuest(app, id);
    if (!canAccessGuest(request.authUser, guest)) throw forbidden('该资源不在你的授权范围内');
    return {
      data: app.services.audit.timeline('guest', `${guest.clusterId}:${guest.vmid}`),
    };
  });

  app.post('/api/v1/guests', { preHandler: app.requirePermission('guest.create') }, async (request, reply) => {
    const body = parseInput(guestCreateSchema, request.body);
    const result = await app.services.pipeline.createGuest(requestContext(request), {
      clusterId: body.clusterId,
      type: body.type,
      name: body.name,
      node: body.node,
      cores: body.cores,
      memoryMb: body.memoryMb,
      diskGb: body.diskGb,
      storage: body.storage,
      templateId: body.templateId,
      templateNode: body.templateNode,
      iso: body.iso,
      networkBridge: body.networkBridge,
      rateMbps: body.rateMbps,
      startOnCreate: body.startOnCreate,
      ownerId: body.ownerId,
    });
    reply.status(201);
    return { data: result };
  });

  app.post('/api/v1/guests/:id/actions', { preHandler: app.requirePermission('guest.power') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = parseInput(powerSchema, request.body);
    const guest = loadGuest(app, id);
    const result = await app.services.pipeline.power(
      requestContext(request),
      guest,
      body.action as PowerAction,
    );
    return { data: result };
  });

  app.patch('/api/v1/guests/:id/config', { preHandler: app.requirePermission('guest.config') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = parseInput(configSchema, request.body);
    if (Object.keys(body).length === 0) throw badRequest('未提供任何配置变更');
    const guest = loadGuest(app, id);
    const result = await app.services.pipeline.updateConfig(requestContext(request), guest, body);
    return { data: result };
  });

  app.delete('/api/v1/guests/:id', { preHandler: app.requirePermission('guest.delete') }, async (request) => {
    const { id } = request.params as { id: string };
    const guest = loadGuest(app, id);
    const result = await app.services.pipeline.deleteGuest(requestContext(request), guest);
    return { data: result };
  });

  app.post('/api/v1/guests/:id/console', { preHandler: app.requirePermission('guest.console') }, async (request) => {
    const { id } = request.params as { id: string };
    const guest = loadGuest(app, id);
    const result = await app.services.pipeline.openConsole(requestContext(request), guest);
    return {
      data: {
        sessionId: result.session.id,
        kind: result.session.kind,
        guestType: result.session.guestType,
        expiresAt: result.session.expiresAt,
        upstreamPort: result.session.port,
      },
    };
  });

  app.post('/api/v1/guests/:id/template', { preHandler: app.requirePermission('template.manage') }, async (request) => {
    const { id } = request.params as { id: string };
    const guest = loadGuest(app, id);
    const result = await app.services.pipeline.markTemplate(requestContext(request), guest);
    return { data: result };
  });
}
