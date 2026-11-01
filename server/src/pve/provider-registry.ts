import type { AppConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { getCluster } from '../modules/clusters/cluster-repo.js';
import { decryptSecret } from '../lib/secret-box.js';
import { notFound } from '../lib/errors.js';
import { MockProvider } from './mock-provider.js';
import { PveApiProvider } from './pve-api.js';
import type { ClusterProvider } from './types.js';
import type { ClusterRecord } from '../domain.js';

/**
 * 集群提供方注册表：按集群配置惰性构建并缓存 Provider。
 * 集群配置变更后缓存自动失效，多集群互不影响。
 */
export class ProviderRegistry {
  private readonly cache = new Map<string, { signature: string; provider: ClusterProvider }>();

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  get(clusterId: string): ClusterProvider {
    const cluster = getCluster(this.db, clusterId);
    if (!cluster) throw notFound('集群不存在');
    return this.forCluster(cluster);
  }

  forCluster(cluster: ClusterRecord): ClusterProvider {
    const signature = `${cluster.updatedAt}|${cluster.provider}|${cluster.apiUrl}|${cluster.tokenId}`;
    const cached = this.cache.get(cluster.id);
    if (cached && cached.signature === signature) return cached.provider;

    let provider: ClusterProvider;
    if (cluster.provider === 'mock') {
      provider = new MockProvider();
    } else {
      let secret = '';
      if (cluster.tokenSecretEnc) {
        try {
          secret = decryptSecret(cluster.tokenSecretEnc, this.config.encryptionKey);
        } catch {
          secret = '';
        }
      }
      provider = new PveApiProvider({
        apiUrl: cluster.apiUrl,
        tokenId: cluster.tokenId,
        tokenSecret: secret,
        verifyTls: cluster.verifyTls,
      });
    }
    this.cache.set(cluster.id, { signature, provider });
    return provider;
  }

  invalidate(clusterId: string): void {
    this.cache.delete(clusterId);
  }

  clear(): void {
    this.cache.clear();
  }
}
