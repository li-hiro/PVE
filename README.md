# VirtGate · PVE 自助管理与审计门户

面向中小企业虚拟化运维场景的 Proxmox VE 自助服务与合规审计平台。它把"谁能用多少资源、做了什么操作、是否合规"三件事收敛到一个可审计的控制平面，让研发、业务与运维在不直接登录 PVE 的前提下自助开通与管理虚拟机 / 容器。

- **技术栈完全开源**：Node.js 24 + TypeScript + Fastify 5 + SQLite（`node:sqlite`）+ React 19 + Vite 7 + ECharts 6，全部依赖均为 MIT / Apache-2.0 / BSD / ISC 等宽松许可证，仓库内置自动化许可证审计。
- **独立实现**：认证、RBAC、配额预占、审计哈希链、异常检测、PVE 接入层与前端设计系统均为本项目原创实现，未复制任何同类项目的架构或代码。
- **可落地**：`docker compose` 一条命令启动，内置 Mock 集群与演示账号，无需真实 PVE 即可完整体验全部功能。

> 当前版本 `1.0.0`。真实 PVE 环境通过 API Token 接入；演示模式下的控制台为回显终端，真实 QEMU 图形控制台请在二次开发中接入 VNC 帧缓冲渲染。

---

## 目录

- [功能总览](#功能总览)
- [系统架构](#系统架构)
- [快速开始](#快速开始)
- [演示账号](#演示账号)
- [配置项](#配置项)
- [使用说明](#使用说明)
- [测试与质量校验](#测试与质量校验)
- [目录结构](#目录结构)
- [安全说明](#安全说明)
- [二次开发](#二次开发)
- [开源许可与贡献](#开源许可与贡献)

---

## 功能总览

### 1. PVE 集群资源自助管理

| 能力 | 说明 |
| --- | --- |
| 集群接入 | 支持多套 PVE 集群并存，API Token 加密存储（AES-256-GCM），可选跳过自签证书校验 |
| 资源清单 | 统一列表 / 筛选 / 排序虚拟机与容器，展示节点、状态、规格、归属部门与负责人 |
| 自助创建 | 从模板克隆或空白创建 QEMU / LXC，创建前自动校验配额并预占资源 |
| 生命周期 | 启动、停止、关机、重启、重置、挂起；删除资源需独立权限 |
| 配置调整 | 在线调整 CPU 核心数、内存与名称，变更写入审计链 |
| 模板管理 | 将已有资源标记为模板，供部门内自助克隆 |
| 控制台 | 一次性会话票据 + WebSocket 网关；LXC 提供串口终端，QEMU 预留 VNC 通道 |
| 集群同步 | 定时拉取节点、资源与指标，失败自动降级并生成可用性告警 |

### 2. 资源配额与权限体系

- **细粒度 RBAC**：26 项权限点（查看、创建、电源、配置、删除、控制台、模板、配额、用户、角色、部门、审计、告警……），角色可自定义。
- **三种数据范围**：`global`（全平台）、`department`（本部门）、`own`（仅本人），所有列表查询在 SQL 层叠加范围过滤。
- **双维度配额**：部门配额 + 用户配额，覆盖 CPU 核数、内存 MB、存储 GB、网络 Mbps 与资源数量上限。
- **预占式防超卖**：创建资源时在 `BEGIN IMMEDIATE` 事务内校验"已用 + 预占"，成功后才调用 PVE，失败自动释放预留。
- **配额优先链**：同时配置部门与用户配额时取更严格的上限，避免部门管理员自行放宽。

### 3. 全链路审计门户

- **操作流水**：每次运维操作记录操作者、动作、目标、结果、IP、请求 ID、耗时与前后快照。
- **防篡改哈希链**：`hash = SHA-256(prevHash + "\n" + canonicalJson(payload))`，append-only，支持按区间复算校验。
- **轨迹回放**：按资源、按请求 ID 聚合出完整操作时间线，可还原一次故障处理的全过程。
- **异常行为告警**：滑动时间窗检测越权爆发、失败爆发、高风险操作爆发、暴力破解、非工作时段操作。
- **合规报表**：一键导出 CSV（带 BOM，Excel 直接打开）或 JSON（含链完整性校验结果），导出行为本身也会入链。

### 4. 可视化监控面板

- 集群规模、运行 / 停止 / 模板数量、节点 CPU / 内存 / 存储水位一屏呈现。
- 24 小时资源趋势图（ECharts），支持 1h / 6h / 24h / 7d 区间切换。
- 告警摘要、异常事件、最近操作与审计事件实时汇总，单次请求聚合渲染。

---

## 系统架构

```
┌────────────────────────────────────────────────────────────┐
│  Browser (React 19 + Vite)                                  │
│  仪表盘 / 资源 / 配额 / 审计 / 告警 / 组织 / 集群 / 控制台   │
└───────────────────────┬────────────────────────────────────┘
                        │ HTTPS + JWT / WebSocket
┌───────────────────────▼────────────────────────────────────┐
│  Nginx（生产镜像内置）                                       │
│  静态资源 + /api 反向代理 + WebSocket 升级                    │
└───────────────────────┬────────────────────────────────────┘
┌───────────────────────▼────────────────────────────────────┐
│  Fastify 5 控制平面                                          │
│                                                            │
│  routes/          10 组 REST 路由 + 控制台 WS               │
│  services/                                                   │
│    operation-pipeline  权限 → 配额预占 → 执行 → 落库 → 审计   │
│    quota-service       用量聚合与预占事务                     │
│    audit-ledger        哈希链写入 / 校验 / 报表                │
│    anomaly-service     滑动窗口异常检测                       │
│    sync-worker         定时同步与可用性告警                   │
│    access              RBAC 与行级数据范围                    │
│  pve/                                                       │
│    pve-api.ts          PVE REST /api2/json 客户端           │
│    mock-provider.ts    内存态演示集群                         │
│    provider-registry   Provider 注册与缓存                    │
├────────────────────────────────────────────────────────────┤
│  SQLite（node:sqlite，WAL）                                  │
│  用户 / 角色 / 部门 / 集群 / 资源 / 配额 / 预占 / 操作 /       │
│  审计事件 / 告警 / 指标快照                                   │
└────────────────────────────────────────────────────────────┘
                        │
              ┌─────────▼─────────┐
              │  PVE 集群 1..N     │
              │  /api2/json        │
              └───────────────────┘
```

关键设计取舍：

1. **单体双进程**：控制平面与静态门户分开构建、同机部署，避免引入额外中间件，中小企业单机即可运行。
2. **SQLite + WAL**：零外部依赖、备份即复制文件；写事务使用 `BEGIN IMMEDIATE` 保证配额预占的串行化。
3. **Provider 抽象**：虚拟化后端通过 `ClusterProvider` 接口隔离，新增集群类型只需实现接口并注册，不改动业务层。
4. **审计即副作用**：所有写操作统一经过操作管道与审计账本，避免"某条路由忘了记日志"。

---

## 快速开始

### 方式一：Docker Compose（推荐）

前置要求：Docker Engine 24+、Docker Compose v2。

```bash
git clone <your-repo-url> virtgate
cd virtgate
bash scripts/deploy.sh
```

脚本会自动复制 `.env`、生成随机的 `JWT_SECRET` 与 `ENCRYPTION_KEY`、构建镜像并等待健康检查。就绪后访问：

- 门户：<http://127.0.0.1:8088>
- 健康检查：<http://127.0.0.1:8088/healthz>

常用命令：

```bash
docker compose logs -f server     # 查看后端日志
docker compose down               # 停止服务（数据卷保留）
docker compose down -v            # 停止并删除数据卷（慎用）
```

手动编排：

```bash
cp .env.example .env
# 修改 JWT_SECRET / ENCRYPTION_KEY / WEB_PORT
docker compose up -d --build
```

### 方式二：本地开发

前置要求：Node.js 24+（`node:sqlite` 需要 22.5+，推荐 24）。

```bash
npm run setup          # 安装 server 与 web 依赖
cp .env.example .env   # 本地开发可保留默认密钥
npm run dev:server     # http://127.0.0.1:8080
npm run dev:web        # http://127.0.0.1:5173
```

开发模式下 Vite 会将 `/api` 与 WebSocket 请求代理到 `127.0.0.1:8080`，两个终端并行运行即可。

生产环境单机运行（不容器化）：

```bash
npm run build
NODE_ENV=production JWT_SECRET=... ENCRYPTION_KEY=... npm start
```

---

## 演示账号

`DEMO_MODE=true`（默认）时会自动创建演示集群 `cluster-demo`（Mock Provider，2 节点、14 个资源、正弦波动指标）与以下账号：

| 账号 | 密码 | 角色 | 数据范围 | 典型体验 |
| --- | --- | --- | --- | --- |
| `admin` | `Admin@12345` | 平台管理员 | 全局 | 全部功能，含集群接入、角色与配额管理 |
| `alice` | `Demo@12345` | 部门管理员 | 研发中心 | 部门内资源、用户、配额与审计 |
| `bob` | `Demo@12345` | 运维操作员 | 研发中心 | 自助创建、启停、控制台，无删除权限 |
| `carol` | `Demo@12345` | 只读成员 | 业务支持部 | 只读视图，验证数据隔离 |
| `dave` | `Demo@12345` | 运维操作员 | 财务部 | 验证跨部门隔离 |
| `frank` | `Demo@12345` | 部门管理员 | 业务支持部 | 验证部门配额约束 |
| `eve` | `Demo@12345` | 合规审计员 | 全局只读 | 审计检索、链校验与报表导出 |

> 生产部署请将 `DEMO_MODE=false`，并在首次登录后修改 `admin` 密码。`BOOTSTRAP_ADMIN_PASSWORD` 仅在用户表为空时生效。

---

## 配置项

所有配置均通过环境变量注入，完整模板见 [`.env.example`](.env.example)。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` 时强制要求显式设置 `JWT_SECRET` 与 `ENCRYPTION_KEY` |
| `HOST` / `PORT` | `0.0.0.0` / `8080` | 后端监听地址 |
| `DATABASE_PATH` | `./data/virtgate.db` | SQLite 文件路径，容器内为 `/app/data/virtgate.db` |
| `JWT_SECRET` | 开发默认值 | JWT 签名密钥，生产必填 |
| `JWT_EXPIRES_IN` | `8h` | 令牌有效期 |
| `ENCRYPTION_KEY` | 开发默认值 | 集群 Token 的 AES-256-GCM 加密密钥，生产必填 |
| `CORS_ORIGINS` | `http://localhost:5173` | 允许的跨域来源，逗号分隔 |
| `LOG_LEVEL` | `info` | Pino 日志级别 |
| `DEMO_MODE` | `true` | 是否写入 Mock 集群与演示用户 |
| `BOOTSTRAP_ADMIN_PASSWORD` | `Admin@12345` | 初始管理员密码（仅首次建库生效） |
| `DEMO_USER_PASSWORD` | `Demo@12345` | 演示用户密码 |
| `SYNC_ENABLED` / `SYNC_INTERVAL_SEC` | `true` / `30` | 集群同步开关与间隔 |
| `METRICS_RETENTION_DAYS` | `7` | 指标快照保留天数 |
| `CONSOLE_TTL_SEC` | `300` | 控制台一次性会话有效期 |
| `ALERT_CPU_THRESHOLD` 等 | `85` / `90` / `92` | 节点 CPU / 内存 / 存储告警阈值（百分比） |
| `ANOMALY_*` | 见模板 | 异常检测窗口、爆发阈值与非工作时段 |
| `ALERT_WEBHOOK_URL` | 空 | 可选告警 Webhook，留空不推送 |
| `WEB_PORT` | `8088` | Compose 中门户对外端口 |

生成密钥：

```bash
openssl rand -hex 32
```

集群接入所需 PVE Token：在 PVE 节点执行

```bash
pveum user add virtgate@pve
pveum aclmod / -user virtgate@pve -role PVEAuditor
pveum aclmod /vms -user virtgate@pve -role PVEVMAdmin
pveum token add virtgate@pve token-virtgate --privsep 0
```

令牌标识形如 `virtgate@pve!token-virtgate`，密钥仅显示一次，填入集群表单后由平台加密存储。

---

## 使用说明

1. **接入集群**：以 `admin` 登录，进入「集群」页新增 PVE 集群，填入 API 地址与 Token，先「测试连接」再「同步」。
2. **配置组织**：在「部门 / 用户 / 角色」页建立部门、分配角色；角色决定权限点，角色作用域决定数据范围。
3. **设置配额**：在「配额」页为部门或用户设置 CPU、内存、存储、网络与数量上限；用量与预占实时可见。
4. **自助开通**：运维角色在「资源」页选择模板，填写规格与归属，系统校验配额后调用 PVE 创建。
5. **日常运维**：在资源详情页执行启停、调整配置、打开控制台；高风险操作需要 `guest.delete` 等独立权限。
6. **审计核查**：在「审计」页按时间、操作者、动作、结果检索，查看轨迹时间线，执行哈希链校验，导出 CSV / JSON 报表。
7. **告警处置**：在「告警」页查看资源水位与异常行为告警，确认后自动写入审计链。

---

## 测试与质量校验

```bash
npm test                 # 后端 36 项 + 前端 19 项
npm run typecheck        # 两端 TypeScript 严格校验
npm run build            # 后端 tsc + 前端 Vite 生产构建
npm run license:check    # 依赖许可证审计（违规即退出码 1）
```

单独运行：

```bash
npm run test:server      # tests/unit + tests/integration
npm run test:web         # Vitest + jsdom
node scripts/license-check.mjs --json   # 机器可读的许可证报告
```

测试覆盖重点：

- 审计哈希链的追加、篡改检测与区间校验；
- 配额预占、并发创建时的防超卖与释放；
- RBAC 权限点与三种数据范围的行级过滤；
- 集群 Token 加解密、密钥掩码；
- 登录 / 鉴权 / 越权访问 / 页面数据范围等集成场景；
- 前端格式化、API 封装、分页、通用组件渲染。

---

## 目录结构

```
.
├── server/                     # Fastify 控制平面
│   ├── src/
│   │   ├── app.ts              # 应用装配入口
│   │   ├── main.ts             # 进程启动与优雅退出
│   │   ├── config.ts           # 环境变量配置
│   │   ├── db/                 # schema、连接、种子数据
│   │   ├── lib/                # 错误、HTTP、摘要、加密
│   │   ├── modules/            # 按领域划分的仓储层
│   │   ├── pve/                # PVE 客户端、Mock、Provider 注册
│   │   ├── plugins/            # 认证与错误处理插件
│   │   ├── routes/             # REST 路由
│   │   └── services/           # 操作管道、配额、审计、异常、同步
│   └── tests/                  # unit / integration
├── web/                        # React 门户
│   ├── src/
│   │   ├── components/         # 布局、通用组件、图表、控制台
│   │   ├── lib/                # API 客户端、认证、格式化
│   │   ├── pages/              # 业务页面
│   │   └── styles.css          # 手写设计系统
│   └── nginx.conf              # 生产反向代理配置
├── docs/                       # 架构、API、部署、扩展、许可证
├── scripts/                    # 部署脚本、许可证审计
├── docker-compose.yml
├── .github/workflows/ci.yml
└── .env.example
```

---

## 安全说明

- **密钥**：生产必须设置强随机 `JWT_SECRET` 与 `ENCRYPTION_KEY`，切勿提交 `.env`。
- **Token 存储**：PVE API Token 使用 AES-256-GCM 加密，接口返回时仅给出 `tokenSecretSet` 标记，不回显明文。
- **最小权限**：默认角色按最小权限设计；删除、配额与集群管理均为独立权限点。
- **数据范围**：列表、详情、审计与配额接口均在服务端做范围校验，前端隐藏入口只是体验优化。
- **控制台**：票据一次性、短时效，建立连接时复核账号状态、权限、资源归属与过期时间。
- **审计完整性**：哈希链只追加不修改，导出与校验动作本身也入链；建议定期将导出报表异地留存。
- **部署**：建议置于内网或经 VPN 访问，前置 TLS 终结；反向代理需正确传递 `X-Forwarded-For` 以便审计记录真实 IP。

发现安全问题请参考 [SECURITY.md](SECURITY.md)，勿直接公开提交可利用细节的 Issue。

---

## 二次开发

- **新增虚拟化后端**：实现 `server/src/pve/types.ts` 中的 `ClusterProvider`，在 `provider-registry.ts` 注册，即可被操作管道复用。
- **新增权限点**：在 `modules/rbac/catalog.ts` 增加权限定义，然后在内置角色或自定义角色中分配。
- **新增业务路由**：按 `routes/` 现有模式注册，写操作调用 `operation-pipeline` 或 `recordAudit` 以保证审计完整。
- **前端扩展**：`lib/api.ts` 统一封装请求与错误信封，`lib/use-api.ts` 提供分页与加载状态，页面按 `pages/` 模式新增并在 `App.tsx` 注册路由。
- **告警外送**：配置 `ALERT_WEBHOOK_URL` 即可把告警推送到企业 IM 或自建服务。

详细说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 与 [docs/EXTENDING.md](docs/EXTENDING.md)。

---

## 开源许可与贡献

- 项目代码采用 [Apache License 2.0](LICENSE)。
- 第三方依赖仅限 MIT / Apache-2.0 / BSD / ISC / CC0 等宽松许可证，`npm run license:check` 会在 CI 中强制校验。
- 依赖清单与许可证说明见 [docs/LICENSES.md](docs/LICENSES.md)。
- 参与贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

VirtGate 不是 Proxmox GmbH 的官方产品，Proxmox VE 为其各自权利人的商标。本项目仅通过公开 REST API 对接，不包含任何 PVE 源码或闭源组件。
