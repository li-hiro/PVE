# API 参考

VirtGate 控制平面提供 `/api/v1` 前缀的 REST 接口，以及一个用于控制台的 WebSocket 端点。本文件列出全部公开接口、权限点与请求要点。

## 1. 通用约定

### 1.1 认证

除 `/healthz`、`/api/v1/meta/*`、`/api/v1/auth/login` 外，所有接口要求：

```
Authorization: Bearer <JWT>
```

令牌由登录接口返回，默认有效期 8 小时（`JWT_EXPIRES_IN`）。

### 1.2 响应信封

成功：

```json
{ "data": { ... } }
```

列表：

```json
{
  "data": [ ... ],
  "meta": { "page": 1, "pageSize": 20, "total": 137 }
}
```

失败：

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "该资源不在你的授权范围内",
    "details": null,
    "requestId": "req-1"
  }
}
```

错误码：`VALIDATION_ERROR`(400)、`UNAUTHENTICATED`(401)、`FORBIDDEN`(403)、`NOT_FOUND`(404)、`CONFLICT`(409)、`QUOTA_EXCEEDED`(403)、`RATE_LIMITED`(429)、`UPSTREAM_ERROR`(502)、`INTERNAL_ERROR`(500)。

所有响应附带 `X-Request-Id`，可用于审计检索（`GET /api/v1/audit/request/:requestId`）。

### 1.3 分页与筛选

列表接口统一支持 `page`（默认 1）与 `pageSize`（默认 20，上限由服务端收敛），并返回 `meta.total`。时间筛选使用 ISO 8601 字符串 `from` / `to`。

### 1.4 权限点

写操作在路由层声明权限点；无权限时返回 403 并写入 `access.denied` 审计事件。权限点全表见 `server/src/modules/rbac/catalog.ts`。

## 2. 元信息与健康检查

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/healthz` | 无 | 存活探针，返回版本与服务器时间 |
| GET | `/api/v1/meta/bootstrap` | 无 | 能力清单、权限目录、演示模式标记 |
| GET | `/api/v1/meta/health` | 无 | 数据种子摘要、集群与资源统计、未关闭告警数 |

## 3. 认证

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/login` | 无 | `{ username, password }`，返回 `{ token, user }`；同账号 1 分钟最多 6 次 |
| GET | `/api/v1/auth/me` | 登录 | 当前用户、角色、权限与数据范围 |
| POST | `/api/v1/auth/logout` | 登录 | 记录登出审计事件 |
| POST | `/api/v1/auth/password` | 登录 | `{ currentPassword, newPassword }`，新密码至少 8 位 |

## 4. 组织与权限

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/users` | `user.read` | 用户列表，部门管理员仅见本部门 |
| GET | `/api/v1/users/candidates` | `user.read` | 可分配为资源负责人的用户候选 |
| POST | `/api/v1/users` | `user.manage` | 创建用户（用户名 3-32 位字母数字等） |
| PATCH | `/api/v1/users/:id` | `user.manage` | 修改显示名、角色、部门、邮箱、状态 |
| POST | `/api/v1/users/:id/reset-password` | `user.manage` | `{ newPassword }` |
| DELETE | `/api/v1/users/:id` | `user.manage` | 删除用户（不允许删除最后一个平台管理员） |
| GET | `/api/v1/roles` | `role.read` | 角色列表（含内置角色） |
| POST | `/api/v1/roles` | `role.manage` | `{ name, description, scope, permissions[] }` |
| PATCH | `/api/v1/roles/:id` | `role.manage` | 修改自定义角色，内置角色受保护 |
| DELETE | `/api/v1/roles/:id` | `role.manage` | 有用户引用时拒绝删除 |
| GET | `/api/v1/permissions` | `role.read` | 权限目录（按分组） |
| GET | `/api/v1/departments` | `department.read` | 部门列表与成员统计 |
| POST | `/api/v1/departments` | `department.manage` | `{ name, description }` |
| PATCH | `/api/v1/departments/:id` | `department.manage` | 修改部门 |
| DELETE | `/api/v1/departments/:id` | `department.manage` | 有引用时拒绝删除 |

角色作用域：`global`（全平台）、`department`（本部门）、`own`（仅本人）。

## 5. 集群

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/clusters` | `cluster.read` | 集群列表（Token 仅返回 `tokenSecretSet`） |
| GET | `/api/v1/clusters/:id` | `cluster.read` | 集群详情 |
| POST | `/api/v1/clusters` | `cluster.manage` | `{ name, provider, apiUrl, tokenId, tokenSecret, verifyTls, enabled }` |
| PATCH | `/api/v1/clusters/:id` | `cluster.manage` | 修改配置；`tokenSecret` 留空表示不修改 |
| POST | `/api/v1/clusters/:id/test` | `cluster.manage` | 连接测试，返回版本与节点数 |
| POST | `/api/v1/clusters/:id/sync` | `cluster.manage` | 立即同步，返回节点 / 资源数量、异常停止数与耗时 |
| DELETE | `/api/v1/clusters/:id` | `cluster.manage` | `?force=1` 可强制移除（仍受资源数量保护） |

`provider` 仅支持 `pve` 与 `mock`，创建后不可变更。Token 使用 AES-256-GCM 加密落库。

## 6. 虚拟机与容器

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/guests` | `guest.read` | 支持 `clusterId`、`status`、`type`、`template`、`departmentId`、`ownerId`、`q`、`sort` |
| GET | `/api/v1/guests/templates` | `template.read` | 可克隆模板列表 |
| GET | `/api/v1/guests/:id` | `guest.read` | 详情：资源、最近操作、审计时间线、负责人配额 |
| GET | `/api/v1/guests/:id/timeline` | `audit.read` | 资源完整审计时间线 |
| POST | `/api/v1/guests` | `guest.create` | 创建资源（见下） |
| POST | `/api/v1/guests/:id/actions` | `guest.power` | `{ action }`：`start` / `stop` / `shutdown` / `reboot` / `reset` / `suspend` |
| PATCH | `/api/v1/guests/:id/config` | `guest.config` | 调整 `cores` / `memoryMb` / `name` |
| DELETE | `/api/v1/guests/:id` | `guest.delete` | 删除资源 |
| POST | `/api/v1/guests/:id/console` | `guest.console` | 申请一次性控制台会话 |
| POST | `/api/v1/guests/:id/template` | `template.manage` | 标记为模板 |

创建请求示例：

```json
{
  "clusterId": "cluster-demo",
  "type": "qemu",
  "name": "web-dev-01",
  "node": "node-a",
  "cores": 4,
  "memoryMb": 8192,
  "diskGb": 40,
  "storage": "local-lvm",
  "templateId": 9001,
  "templateNode": "node-a",
  "iso": null,
  "networkBridge": "vmbr0",
  "rateMbps": 100,
  "startOnCreate": true,
  "ownerId": "user-bob"
}
```

约束：名称 2-63 位且以字母或数字开头；CPU 1-64；内存 128-1048576 MB；磁盘 1-4096 GB。配额不足返回 `QUOTA_EXCEEDED`，`details` 中包含具体维度。

## 7. 配额

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/quotas` | `quota.read` | 管理员返回全部部门 + 用户配额；其他角色返回本部门与本人 |
| GET | `/api/v1/quotas/me` | 登录 | 本人配额快照 |
| GET | `/api/v1/quotas/effective` | `quota.read` | `?scopeType=department|user&scopeId=`，返回有效限额与用量 |
| PUT | `/api/v1/quotas` | `quota.manage` | 设置 / 更新配额，变更前后快照写入审计 |
| DELETE | `/api/v1/quotas/:scopeType/:scopeId` | `quota.manage` | 移除配额策略（恢复为不限） |

配额字段：`cpuCores`、`memoryMb`、`storageGb`、`networkMbps`、`guestLimit`；`null` 表示不限。快照同时返回 `used` 与 `reserved`。

## 8. 审计与操作记录

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/operations` | `operation.read` | 操作流水，支持 `clusterId`、`actorId`、`vmid`、`action`、`status`、`q`、时间范围 |
| GET | `/api/v1/audit/events` | `audit.read` | 审计事件检索，支持 `actorId`、`action`、`targetType`、`targetId`、`result`、`q`、时间范围 |
| GET | `/api/v1/audit/events/:id` | `audit.read` | 单条事件（做范围复核） |
| GET | `/api/v1/audit/stats` | `audit.read` | 按天聚合统计，`days` 默认 7 |
| GET | `/api/v1/audit/timeline` | `audit.read` | `?targetType=&targetId=` 轨迹时间线 |
| GET | `/api/v1/audit/request/:requestId` | `audit.read` | 按请求 ID 聚合一次请求的全部事件 |
| POST | `/api/v1/audit/verify` | `audit.verify` | `{ fromSeq?, toSeq? }` 校验哈希链区间 |
| GET | `/api/v1/audit/export` | `audit.export` | `?format=csv|json&days=30`，导出合规报表 |

导出响应带 `Content-Disposition`，CSV 含 BOM 便于 Excel 打开；JSON 附带 `verification` 校验结果。导出动作本身写入审计链。

## 9. 告警

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/alerts/summary` | `alert.read` | 按严重级别与状态聚合 |
| GET | `/api/v1/alerts` | `alert.read` | 支持 `status`、`severity`、`category`、`q` |
| GET | `/api/v1/alerts/:id` | `alert.read` | 告警详情 |
| POST | `/api/v1/alerts/:id/ack` | `alert.manage` | 确认告警，写入审计 |

类别：`anomaly`（异常行为）、`resource`（水位阈值）、`availability`（可用性）、`operation`（操作类）。

## 10. 监控面板

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/dashboard/overview` | `dashboard.read` | 一次返回集群、资源、节点、24h 指标、告警、操作、审计、配额 |
| GET | `/api/v1/dashboard/metrics` | `dashboard.read` | `?range=1h|6h|24h|7d&clusterId=` |
| GET | `/api/v1/dashboard/operations` | `operation.read` | 最近操作（按数据范围过滤） |

## 11. 控制台 WebSocket

```
ws(s)://<host>/api/v1/console/<sessionId>?token=<JWT>
```

- 会话由 `POST /api/v1/guests/:id/console` 创建，默认 300 秒有效且仅可使用一次。
- 网关复核令牌、账号状态、权限点、资源范围与过期时间。
- LXC：首帧发送 `user:ticket` 完成认证，随后双向透传串口数据。
- QEMU：转发到 PVE VNC 端口，浏览器端渲染属于二次开发扩展点。

## 12. curl 示例

```bash
# 登录
TOKEN=$(curl -s -X POST http://127.0.0.1:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin@12345"}' | jq -r .data.token)

# 资源列表
curl -s http://127.0.0.1:8080/api/v1/guests?page=1 \
  -H "Authorization: Bearer $TOKEN" | jq

# 校验审计链
curl -s -X POST http://127.0.0.1:8080/api/v1/audit/verify \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}' | jq
```
