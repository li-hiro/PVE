# 二次开发指南

VirtGate 以"领域模块 + 服务编排 + 路由适配"分层，扩展点集中在 Provider 抽象、权限目录、服务管道与前端请求封装。本文给出常见扩展场景的落地步骤。

## 1. 接入新的虚拟化后端

### 1.1 实现 Provider 接口

新建 `server/src/pve/<your-backend>.ts`，实现 `ClusterProvider`（见 `server/src/pve/types.ts`）：

```ts
import type { ClusterProvider } from './types.js';

export class MyBackendProvider implements ClusterProvider {
  readonly kind = 'mybackend' as const;

  async probe() { /* 返回 { version, nodeCount } */ }
  async listNodes() { /* ProviderNodeInfo[] */ }
  async listGuests() { /* ProviderGuestInfo[] */ }
  async metrics(nodes, guests) { /* ProviderMetricsInfo[] */ }
  async createGuest(spec) { /* { vmid, node, status } */ }
  async power(vmid, node, type, action) { /* 返回新状态 */ }
  async updateConfig(vmid, node, type, patch) { /* void */ }
  async deleteGuest(vmid, node, type) { /* void */ }
  async markTemplate(vmid, node, type) { /* void */ }
  async openConsole(vmid, node, type) { /* ProviderConsoleTicket */ }
  webSocketUrl(path) { return `${this.baseUrl}${path}`; }
  webSocketHeaders() { return { Authorization: `PVEAPIToken=...` }; }
}
```

### 1.2 注册 Provider

1. `server/src/domain.ts` 的 `ProviderKind` 增加 `'mybackend'`；
2. `server/src/pve/provider-registry.ts` 中按 `cluster.provider` 分支实例化；
3. `server/src/routes/clusters.ts` 的建集群 / 改集群 zod schema 允许新的 kind；
4. 如涉及新的凭据字段，扩展 `clusters` 表与 `maskCluster`，确保密钥不明文回显。

完成后，同步、操作管道、控制台会自动复用新 Provider，无需改动业务层。

### 1.3 建议

- Provider 内部自行处理超时与重试，向上抛出 `AppError`（`upstreamError`）。
- 不要在没有配额保障的情况下直接调用 Provider；写操作应走 `OperationPipeline`。

## 2. 新增权限点与角色

```ts
// server/src/modules/rbac/catalog.ts
{ key: 'report.read', label: '查看报表', group: '审计', description: '查看自定义报表' }
```

随后：

1. 在内置角色或自定义角色的 `permissions` 中加入该权限点；
2. 路由使用 `app.requirePermission('report.read')`；
3. 前端 `bootstrap.permissions` 会自动获取目录，权限矩阵无需手工同步；
4. 补充越权访问测试用例（`server/tests/integration`）。

新增权限点会使已部署环境的角色配置不变（原有角色不含新权限），需要在「角色」页手动勾选。

## 3. 新增业务路由

按现有路由模式编写：

```ts
export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/reports/daily', { preHandler: app.requirePermission('report.read') }, async (request) => {
    const scope = actorScope(request.authUser);   // 行级范围过滤
    return { data: await buildDailyReport(app.services.db, scope) };
  });
}
```

在 `server/src/app.ts` 注册：

```ts
await app.register(reportRoutes);
```

写操作必须：

1. 使用 `parseInput(schema, body)` 做 zod 校验；
2. 调用 `app.services.pipeline` 或显式 `app.services.recordAudit(...)`；
3. 在 `operations` 表登记操作流水（如需前端展示执行结果）。

## 4. 扩展配额维度

配额维度定义在：

- `server/src/modules/quotas/quota-repo.ts`（表字段与映射）
- `server/src/services/quota-service.ts`（快照与预占计算）
- `server/src/routes/quotas.ts`（入参校验）
- `web/src/pages/QuotasPage.tsx`（展示与编辑）

新增维度（例如 GPU 数量）时：

1. `quota_policies` 与 `quota_reservations` 增加字段（幂等 `ALTER TABLE` 追加）；
2. 在 `QuotaService` 的 `dimensions` 中加入字段与文案；
3. 在创建 / 调整配置管道中传入新维度；
4. 更新前端配额表单与进度条。

## 5. 告警外送与集成

配置 `ALERT_WEBHOOK_URL` 后，平台会以 POST JSON 推送告警。载荷包含 `id`、`rule`、`severity`、`category`、`title`、`message`、`targetType`、`targetId`、`createdAt`。外送失败不影响告警落库。

如需对接企业 IM，建议在 `server/src/services/alert-service.ts` 中扩展签名校验或消息模板，而不是直接修改路由。

## 6. 审计报表定制

- 结构化数据：`GET /api/v1/audit/export?format=json`，含 `events`、`range` 与 `verification`。
- CSV 列定义在 `server/src/routes/audit.ts` 的 `toCsv`，可追加业务字段（保持哈希链字段完整，便于离线复算）。
- 离线复算脚本可直接复用 `server/src/modules/audit/audit-ledger.ts` 的规范化与哈希逻辑。

## 7. 前端扩展

### 7.1 新增页面

1. 在 `web/src/pages/` 新建页面组件，使用 `useApi` / `useApiPage` 获取数据；
2. 在 `web/src/App.tsx` 注册路由，并用 `RequirePermission` 包裹需要权限的页面；
3. 在 `web/src/components/Layout.tsx` 的导航配置中加入入口，按权限点显隐。

### 7.2 请求与错误

```ts
const { data, loading, error } = useApi<GuestSummary[]>('/guests?page=1');
```

- 统一信封与 401 处理在 `web/src/lib/api.ts`；
- 配额超限等业务错误的友好文案在 `web/src/lib/use-api.ts` 的 `errorMessage`。

### 7.3 样式

设计系统位于 `web/src/styles.css`，使用 CSS 变量定义颜色、间距与圆角。新增组件请复用既有类名（`card`、`btn`、`chip`、`table`、`modal` 等），避免引入新的 CSS 框架。

## 8. 控制台扩展

当前 QEMU 控制台返回票据并保留 WebSocket 转发，但未实现浏览器内 VNC 帧缓冲渲染。扩展方向：

1. 在 `server/src/routes/console.ts` 中把 PVE 的 VNC WebSocket 数据透传给前端；
2. 前端在 `web/src/components/ConsoleModal.tsx` 集成纯 MIT 许可的 VNC 解码库（避免引入 GPL/noVNC 等强传染实现）；
3. 保持一次性票据、时效与权限复核逻辑不变。

## 9. 测试与提交

扩展完成后至少执行：

```bash
npm run typecheck
npm run test:server
npm run test:web
npm run build
npm run license:check
```

新增依赖前确认许可证符合 [CONTRIBUTING.md](../CONTRIBUTING.md) 的依赖引入策略。
