# 架构设计

本文说明 VirtGate 的整体结构、关键机制与设计取舍，适合在部署、排障与二次开发前阅读。

## 1. 设计目标与约束

| 目标 | 落地方式 |
| --- | --- |
| 中小企业可独立运维 | 单体双进程（Fastify + 静态门户），SQLite 持久化，无 Redis / 消息队列 / 外部数据库 |
| 自助但不失控 | 权限点 + 数据范围 + 配额预占三层约束，所有写操作经过统一管道 |
| 操作可追溯 | append-only 审计哈希链，操作流水与审计事件双轨记录 |
| 多集群接入 | `ClusterProvider` 抽象 + Provider 注册表 + 按集群缓存的连接实例 |
| 许可证干净 | 依赖白名单 + CI 许可证审计，禁用 copyleft 与商业授权组件 |
| 易扩展 | 领域模块、服务、路由分层，新增后端或权限点无需改动既有业务 |

非目标：大规模多租户 SaaS、跨区域高可用、实时迁移调度、计费结算。这些场景需要替换存储层与引入消息队列，不属于 v1 范围。

## 2. 分层结构

```
routes/        HTTP 适配层：参数校验（zod）、权限声明、响应信封
services/      业务编排层：权限判定、配额、审计、异常检测、同步
modules/       数据访问层：按领域的 SQL 仓储与映射
pve/           外部系统适配层：PVE REST 客户端、Mock Provider、注册表
db/            SQLite 连接、幂等 DDL、种子数据
lib/           横切能力：错误、请求上下文、摘要、字段加密
```

依赖方向严格单向：`routes → services → modules → db`，`services → pve`。`modules` 不依赖 `services`，`pve` 不依赖业务层，从而保证领域逻辑可单测。

启动装配由 `app.ts` 完成：加载配置 → 打开数据库 → 执行 DDL → 种子数据 → 构造服务 → 注册插件与路由 → 可选启动同步器。`onClose` 负责停止同步、清空 Provider 缓存并关闭自有数据库连接。

## 3. 请求生命周期

以"创建虚拟机"为例：

```
POST /api/v1/guests
  │
  ├─ 1. JWT 认证插件解析令牌，加载用户、角色与权限
  ├─ 2. 路由层 requirePermission('guest.create') 校验权限点
  ├─ 3. OperationPipeline.createGuest
  │      ├─ 写入 operations 记录（status = pending）
  │      ├─ 校验集群存在 / 启用 / 目标归属范围
  │      ├─ QuotaService.reserve（BEGIN IMMEDIATE，校验用量 + 预占）
  │      ├─ Provider.createGuest（PVE REST 或 Mock）
  │      ├─ 本地 guests 表落库、提交配额预占为已用
  │      ├─ 审计账本追加事件（含请求 ID、IP、参数摘要）
  │      ├─ AnomalyService.evaluate（滑动窗口规则）
  │      └─ 更新 operations 为 success / failed
  └─ 4. 响应 { data: { guest, operation } }
```

失败时按阶段回滚：

| 阶段 | 失败处理 |
| --- | --- |
| 权限 / 范围校验 | 写入 `denied` 审计事件，不产生配额预占 |
| 配额预占 | 事务回滚，不调用 Provider |
| Provider 执行 | 释放预占，操作记录为 `failed`，审计记录错误摘要 |
| 本地落库 | 释放预占，尽量回滚远端资源（删除已创建对象） |

## 4. 认证与授权

### 4.1 认证

- 登录：`POST /api/v1/auth/login`，bcrypt 校验，签发 JWT；同一账号 1 分钟内最多 6 次尝试。
- 令牌：默认 8 小时，前端存储于 `localStorage`，所有请求附带 `Authorization: Bearer <token>`。
- 登出：前端清除令牌，后端记录审计事件；JWT 本身无状态，如需强制失效可缩短有效期或扩展吊销表。
- 密码修改：`POST /api/v1/auth/password` 需同时校验旧密码，变更写入审计链。

### 4.2 权限模型

权限点定义在 `modules/rbac/catalog.ts`，是前后端唯一事实来源（前端通过 `/meta/bootstrap` 获取目录）。

| 角色 | 作用域 | 说明 |
| --- | --- | --- |
| `platform_admin` | global | 权限 `*`，全集群全组织 |
| `dept_admin` | department | 本部门资源、用户、模板、审计导出 |
| `operator` | department | 本部门资源自助运维，无删除 / 配额 / 用户管理 |
| `viewer` | department | 只读 |
| `auditor` | global | 只读 + 审计校验与导出 |

角色作用域决定行级过滤：

- `global`：无附加条件。
- `department`：查询自动追加 `department_id = <actor.departmentId>`。
- `own`：查询自动追加 `owner_id = <actor.id>`。

过滤在 SQL 层完成（`services/access.ts` 返回 `scopeSql` 与 `scopeParams`），而非查询后过滤，避免分页统计泄漏。

详情类接口采用"取回后判定"（`canAccessGuest`），审计事件详情则回查操作者所属部门，保证越权访问返回 403 而非 404 混淆。

## 5. 配额与预占

### 5.1 数据模型

- `quota_policies`：按 `(scope_type, scope_id)` 唯一，`NULL` 表示该维度不限。
- `quota_reservations`：创建过程中的临时占用，`state` 为 `active` / `committed` / `released`，带过期时间。

### 5.2 有效限额

用户创建资源时同时受部门与个人配额约束，有效上限取两者中更严格的值。用量按资源归属聚合：部门用量统计本部门全部资源，个人用量统计 `owner_id` 名下资源。

### 5.3 防超卖

SQLite 单写者特性使 `BEGIN IMMEDIATE` 事务天然串行化：

1. 开启立即事务，读取当前用量与活跃预占；
2. 计算"已用 + 预占 + 本次申请"，任一维度超限即抛出 409；
3. 写入 `quota_reservations`（active）；
4. 提交事务后调用 Provider。

Provider 成功后将预占转为已用（新建资源行使统计自然包含），失败则删除预占。超时未提交的预占由过期时间兜底清理。

## 6. 审计哈希链

每条事件：

```
payload  = { seq, ts, actorId, action, targetType, targetId, result, ip, detail, ... }
canonical = canonicalJson(payload)          // 键名排序、去除易变字段
hash      = SHA-256(prevHash + "\n" + canonical)
```

- `prevHash` 取自上一条事件，首条为固定创世串。
- 事件只插入不更新；`seq` 自增，便于区间校验。
- 校验时按 `seq` 升序复算，遇到第一条不匹配即返回断链位置与期望 / 实际哈希。
- 导出 CSV / JSON 时附带当前链校验结果，导出动作本身也写入链，形成"审计审计"的闭环。

局限：哈希链可检测篡改与删除，但不能阻止拥有数据库写权限的攻击者整体重写；生产环境应定期导出并异地留存，或结合对象存储 / WORM 介质。

## 7. 异常行为检测

`AnomalyService` 在每次写操作与登录失败后评估滑动时间窗（默认 10 分钟）：

| 规则 | 触发条件 | 严重级别 |
| --- | --- | --- |
| 越权爆发 | 窗口内 `denied` ≥ `ANOMALY_DENIAL_BURST` | warning |
| 操作失败爆发 | 窗口内失败操作 ≥ `ANOMALY_FAILURE_BURST` | warning |
| 高风险操作爆发 | 窗口内删除 / 模板变更等 ≥ `ANOMALY_DESTRUCTIVE_BURST` | critical |
| 暴力破解 | 窗口内同账号登录失败 ≥ `ANOMALY_LOGIN_FAILURE_BURST` | critical |
| 非工作时段操作 | 本地时间落在配置区间（默认 00:00–06:00） | info |

告警写入 `alerts` 表并按规则去重（同规则同目标在窗口内只生成一条），可选通过 Webhook 外送。

## 8. 集群同步与指标

`SyncWorker` 按 `SYNC_INTERVAL_SEC` 轮询每个启用的集群：

1. `probe()` 获取版本与节点数，更新集群健康状态；
2. `listNodes()` / `listGuests()` 拉取节点与资源，写入 `guests` 表并计算 `last_seen_status`；
3. 检测"预期运行但实际停止"的资源，生成可用性告警；
4. `metrics()` 生成节点水位快照写入 `metrics`，按 `METRICS_RETENTION_DAYS` 清理旧数据。

同步失败不阻塞其他集群，错误写入 `clusters.last_error` 并在下一次轮询重试。Provider 实例按 `(clusterId, updatedAt)` 缓存，集群配置变更时由注册表失效重建。

## 9. 控制台网关

1. 前端调用 `POST /api/v1/guests/:id/console`，后端校验权限与资源范围后向 Provider 申请票据。
2. 票据加密写入 `console_sessions`，有效期默认 300 秒，一次性使用。
3. 前端用会话 ID 建立 WebSocket：`/api/v1/console/:sessionId?token=<JWT>`。
4. 网关复核 JWT、账号状态、权限点、资源范围与会话过期时间，随后代理到 PVE（`rejectUnauthorized` 跟随集群 `verifyTls`）。
5. LXC 首帧发送 `user:ticket` 完成串口认证；QEMU 预留 VNC 通道，当前 Mock 模式返回回显终端。

## 10. 数据模型摘要

| 表 | 用途 | 关键约束 |
| --- | --- | --- |
| `departments` | 部门 | 名称唯一 |
| `roles` | 角色与权限点 JSON | 名称唯一，内置角色标记 `builtin` |
| `users` | 账号、部门、角色、状态 | 用户名唯一 |
| `clusters` | PVE 接入配置 | 名称唯一；Token 密文存储 |
| `guests` | 资源缓存 | `(cluster_id, vmid)` 唯一 |
| `quota_policies` | 部门 / 用户配额 | `(scope_type, scope_id)` 唯一 |
| `quota_reservations` | 配额预占 | 状态与过期时间 |
| `operations` | 操作流水 | 请求 ID、耗时、结果 |
| `audit_events` | 审计哈希链 | 自增 `seq`，`prev_hash` / `hash` |
| `alerts` | 资源 / 异常 / 可用性告警 | 状态 `open` / `ack` / `closed` |
| `metrics` | 节点指标快照 | 按集群 + 节点 + 时间索引 |
| `console_sessions` | 控制台票据 | 短时效、一次性 |

外键删除策略：集群删除级联删除资源；用户删除将资源归属置空（`ON DELETE SET NULL`），避免历史资源失去可查性。

## 11. 失败与降级

- **PVE 不可达**：同步器记录错误并继续服务本地数据，面板显示集群离线状态，资源操作直接返回明确的 502 上游错误。
- **数据库损坏**：启动时执行完整性检查；SQLite 文件与 WAL 应整体备份。
- **审计链断裂**：校验接口返回断点位置，运维可据此判断是数据损坏还是人为篡改，并按导出报表恢复调查。
- **配额冲突**：并发创建时后者收到 409，前端展示具体超限维度。

## 12. 已知限制

- 真实 QEMU 图形控制台尚未实现浏览器内 VNC 帧缓冲渲染，仅保留 WebSocket 转发与接口扩展点。
- JWT 为无状态令牌，登出仅清除客户端凭证；如需即时吊销请扩展服务端令牌版本表。
- 单机 SQLite 适合中小企业规模（万级资源与百万级审计事件）；更大规模需替换为 PostgreSQL 并保留相同仓储接口。
- 异常检测为规则引擎，非机器学习模型；阈值应结合企业实际运维节奏调整。
