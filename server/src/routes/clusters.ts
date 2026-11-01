import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { badRequest, conflict, notFound, upstreamError } from '../lib/errors.js';
import { newId } from '../lib/digest.js';
import { encryptSecret } from '../lib/secret-box.js';
import { parseInput, requestContext } from '../lib/http.js';
import {
  clusterNameExists,
  countGuestsInCluster,
  deleteCluster,
  getCluster,
  insertCluster,
  listClusters,
  updateCluster,
  updateClusterHealth,
} from '../modules/clusters/cluster-repo.js';
import type { ClusterRecord } from '../domain.js';

const createClusterSchema = z.object({
  name: z.string().trim().min(2, '集群名称至少 2 个字符').max(64),
  provider: z.enum(['pve', 'mock']).default('pve'),
  apiUrl: z.string().trim().min(1).max(200),
  tokenId: z.string().trim().max(200).optional().default(''),
  tokenSecret: z.string().trim().max(300).optional().default(''),
  verifyTls: z.boolean().optional().default(true),
  enabled: z.boolean().optional().default(true),
});

const updateClusterSchema = z.object({
  name: z.string().trim().min(2).max(64).optional(),
  apiUrl: z.string().trim().min(1).max(200).optional(),
  tokenId: z.string().trim().max(200).optional(),
  tokenSecret: z.string().trim().max(300).optional(),
  verifyTls: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const maskCluster = (cluster: ClusterRecord) => ({
  id: cluster.id,
  name: cluster.name,
  provider: cluster.provider,
  apiUrl: cluster.apiUrl,
  tokenId: cluster.tokenId,
  tokenSecretSet: cluster.tokenSecretEnc.length > 0 || cluster.provider === 'mock',
  verifyTls: cluster.verifyTls,
  status: cluster.status,
  version: cluster.version,
  nodeCount: cluster.nodeCount,
  enabled: cluster.enabled,
  lastSyncAt: cluster.lastSyncAt,
  lastError: cluster.lastError,
  createdAt: cluster.createdAt,
  updatedAt: cluster.updatedAt,
});

function validateClusterInput(provider: 'pve' | 'mock', apiUrl: string, tokenId: string, tokenSecret: string): void {
  if (provider === 'mock') return;
  if (!/^https?:\/\/.+/i.test(apiUrl)) throw badRequest('PVE 地址必须以 http:// 或 https:// 开头');
  if (!tokenId || !tokenSecret) throw badRequest('PVE 接入必须提供 API Token 标识与密钥');
}

export async function clusterRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/clusters', { preHandler: app.requirePermission('cluster.read') }, async () => ({
    data: listClusters(app.services.db).map(maskCluster),
  }));

  app.get('/api/v1/clusters/:id', { preHandler: app.requirePermission('cluster.read') }, async (request) => {
    const { id } = request.params as { id: string };
    const cluster = getCluster(app.services.db, id);
    if (!cluster) throw notFound('集群不存在');
    return { data: maskCluster(cluster) };
  });

  app.post(
    '/api/v1/clusters',
    { preHandler: app.requirePermission('cluster.manage') },
    async (request, reply) => {
      const body = parseInput(createClusterSchema, request.body);
      if (clusterNameExists(app.services.db, body.name)) throw conflict('集群名称已存在');
      validateClusterInput(body.provider, body.apiUrl, body.tokenId, body.tokenSecret);
      const id = newId();
      insertCluster(app.services.db, {
        id,
        name: body.name,
        provider: body.provider,
        apiUrl: body.provider === 'mock' ? body.apiUrl || 'mock://cluster' : body.apiUrl,
        tokenId: body.tokenId,
        tokenSecretEnc:
          body.provider === 'mock' || !body.tokenSecret
            ? ''
            : encryptSecret(body.tokenSecret, app.services.config.encryptionKey),
        verifyTls: body.verifyTls,
        enabled: body.enabled,
      });
      app.services.registry.invalidate(id);
      const cluster = getCluster(app.services.db, id);
      app.services.recordAudit(requestContext(request), {
        action: 'cluster.create',
        targetType: 'cluster',
        targetId: id,
        result: 'success',
        detail: { name: body.name, provider: body.provider, apiUrl: body.apiUrl, verifyTls: body.verifyTls },
      });
      reply.status(201);
      return { data: cluster ? maskCluster(cluster) : null };
    },
  );

  app.patch(
    '/api/v1/clusters/:id',
    { preHandler: app.requirePermission('cluster.manage') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = parseInput(updateClusterSchema, request.body);
      const cluster = getCluster(app.services.db, id);
      if (!cluster) throw notFound('集群不存在');
      if (body.name && clusterNameExists(app.services.db, body.name, id)) throw conflict('集群名称已存在');
      const nextApiUrl = body.apiUrl ?? cluster.apiUrl;
      const nextTokenId = body.tokenId ?? cluster.tokenId;
      if (cluster.provider !== 'mock') {
        if (!/^https?:\/\/.+/i.test(nextApiUrl)) throw badRequest('PVE 地址必须以 http:// 或 https:// 开头');
        if (!nextTokenId) throw badRequest('PVE 接入必须提供 API Token 标识');
      }
      updateCluster(app.services.db, id, {
        name: body.name,
        apiUrl: body.apiUrl,
        tokenId: body.tokenId,
        verifyTls: body.verifyTls,
        enabled: body.enabled,
        tokenSecretEnc:
          body.tokenSecret && cluster.provider !== 'mock'
            ? encryptSecret(body.tokenSecret, app.services.config.encryptionKey)
            : undefined,
      });
      app.services.registry.invalidate(id);
      app.services.recordAudit(requestContext(request), {
        action: 'cluster.update',
        targetType: 'cluster',
        targetId: id,
        result: 'success',
        detail: { name: body.name ?? cluster.name, enabled: body.enabled ?? cluster.enabled },
      });
      return { data: maskCluster(getCluster(app.services.db, id) ?? cluster) };
    },
  );

  app.delete(
    '/api/v1/clusters/:id',
    { preHandler: app.requirePermission('cluster.manage') },
    async (request) => {
      const { id } = request.params as { id: string };
      const force = (request.query as { force?: string }).force === '1';
      const cluster = getCluster(app.services.db, id);
      if (!cluster) throw notFound('集群不存在');
      const guestCount = countGuestsInCluster(app.services.db, id);
      if (guestCount > 0 && !force) {
        throw conflict('集群下仍缓存有资源记录，如确认移除请携带 force=1', { guestCount });
      }
      deleteCluster(app.services.db, id);
      app.services.registry.invalidate(id);
      app.services.recordAudit(requestContext(request), {
        action: 'cluster.delete',
        targetType: 'cluster',
        targetId: id,
        result: 'success',
        detail: { name: cluster.name, guestCount },
      });
      return { data: { ok: true } };
    },
  );

  app.post(
    '/api/v1/clusters/:id/test',
    { preHandler: app.requirePermission('cluster.manage') },
    async (request) => {
      const { id } = request.params as { id: string };
      const cluster = getCluster(app.services.db, id);
      if (!cluster) throw notFound('集群不存在');
      let result: { ok: boolean; version?: string; nodeCount?: number; error?: string };
      try {
        const provider = app.services.registry.forCluster(cluster);
        const probe = await provider.probe();
        updateClusterHealth(app.services.db, id, {
          status: 'online',
          version: probe.version,
          nodeCount: probe.nodeCount,
          lastError: null,
        });
        result = { ok: true, version: probe.version, nodeCount: probe.nodeCount };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateClusterHealth(app.services.db, id, { status: 'offline', lastError: message });
        result = { ok: false, error: message };
      }
      app.services.recordAudit(requestContext(request), {
        action: 'cluster.test',
        targetType: 'cluster',
        targetId: id,
        result: result.ok ? 'success' : 'failure',
        detail: result,
      });
      return { data: result };
    },
  );

  app.post(
    '/api/v1/clusters/:id/sync',
    { preHandler: app.requirePermission('cluster.manage') },
    async (request) => {
      const { id } = request.params as { id: string };
      const cluster = getCluster(app.services.db, id);
      if (!cluster) throw notFound('集群不存在');
      if (!cluster.enabled) throw conflict('集群已停用，无法同步');
      const report = await app.services.sync.syncCluster(cluster);
      app.services.recordAudit(requestContext(request), {
        action: 'cluster.sync',
        targetType: 'cluster',
        targetId: id,
        result: report.status === 'ok' ? 'success' : 'failure',
        detail: { ...report },
      });
      if (report.status !== 'ok') {
        throw upstreamError('集群同步失败', { error: report.error });
      }
      return { data: report };
    },
  );
}
