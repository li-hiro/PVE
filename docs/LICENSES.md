# 第三方许可证说明

VirtGate 本体代码以 [Apache License 2.0](../LICENSE) 发布。本文说明第三方依赖的许可证情况，以及项目如何持续保证"无闭源、无强传染 copyleft"的依赖策略。

## 1. 许可证策略

允许（宽松开源）：

- MIT、MIT-0、ISC、BSD-2-Clause、BSD-3-Clause、0BSD
- Apache-2.0、Artistic-2.0、Python-2.0、Zlib、Unlicense、CC0-1.0

禁止：

- GPL、AGPL、LGPL（强 / 弱传染）
- MPL、EPL（文件级传染，按项目策略一律禁用）
- BUSL、SSPL、Commons Clause、CC-BY-NC、CC-BY-SA
- 任何商业授权、专有或来源不明的许可证

策略通过 [`scripts/license-check.mjs`](../scripts/license-check.mjs) 自动执行：递归扫描 `server/node_modules`、`web/node_modules`、根 `node_modules`，解析 SPDX 表达式（支持 `OR` / `AND` / `WITH`），按白名单判定，违规或无法识别即返回非零退出码。CI 中强制运行。

```bash
npm run license:check
node scripts/license-check.mjs --json   # 机器可读报告
```

## 2. 直接依赖清单

### 2.1 后端（server）

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| `fastify` | HTTP 框架 | MIT |
| `@fastify/cors` | 跨域 | MIT |
| `@fastify/jwt` | JWT 签发与校验 | MIT |
| `@fastify/websocket` | 控制台 WebSocket | MIT |
| `bcryptjs` | 密码哈希 | MIT |
| `undici` | PVE REST 客户端与 HTTP Agent | MIT |
| `ws` | WebSocket 客户端（PVE 控制台） | MIT |
| `zod` | 请求参数校验 | MIT |
| Node.js 运行时 | 含内置 `node:sqlite` | MIT |

开发期：`typescript`（Apache-2.0）、`tsx`（MIT）、`@types/node` / `@types/ws`（MIT）。

### 2.2 前端（web）

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| `react` / `react-dom` | UI 运行时 | MIT |
| `react-router-dom` | 路由 | MIT |
| `echarts` | 监控图表 | Apache-2.0 |
| `@xterm/xterm` / `@xterm/addon-fit` | LXC 串口终端 | MIT |
| `vite` | 构建工具 | MIT |
| `@vitejs/plugin-react` | React 编译插件 | MIT |
| `vitest` / `jsdom` | 单元测试与 DOM 环境 | MIT |
| `@testing-library/react` / `jest-dom` / `user-event` | 组件测试 | MIT |
| `typescript` | 类型检查 | Apache-2.0 |

### 2.3 构建与部署

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| Rollup / esbuild（Vite 传递依赖） | 打包与压缩 | MIT |
| `nginx:1.29-alpine` | 生产前端静态服务与反向代理 | nginx 自身为 BSD-2-Clause |
| `node:24-alpine` | 后端运行镜像 | Node.js MIT，其余为 Alpine 发行版组件 |

## 3. 关于容器基础镜像的说明

Docker 基础镜像是一个完整的 Linux 发行版，除 Node.js / nginx 本体外还包含 Alpine 的 musl、busybox、openssl 等系统包，其许可证由各自上游决定（部分为 GPL-2.0 等系统级许可证）。

这些组件：

- 属于操作系统发行版的一部分，不以链接方式并入 VirtGate 代码；
- 不构成 VirtGate 的依赖包，也不随项目源码分发；
- 若企业合规要求"运行环境亦不得包含任何 copyleft 组件"，可自行替换为 distroless 或基于 musl 静态构建的自制镜像，本项目不对此做强制约束。

项目自身的 npm 依赖树（生产 + 开发）已通过许可证审计，不含任何 GPL / AGPL / LGPL / MPL / EPL / BUSL 组件。

## 4. 已知的许可证决策记录

| 决策 | 原因 |
| --- | --- |
| 不使用 Tailwind CSS | v4 工具链引入 `lightningcss`（MPL-2.0），与项目策略冲突；改为手写 CSS 设计系统 |
| 不使用 noVNC | noVNC 为 MPL-2.0，禁止引入；控制台改为自研 WebSocket 网关 + `@xterm/xterm` |
| Vite 固定 7.x | Vite 8 硬依赖 `lightningcss`（MPL-2.0）；Vite 7.3.7 + `@vitejs/plugin-react` 5.2.0 的依赖树完全为宽松许可证 |
| 不使用 ORM | 避免额外依赖与迁移工具链，直接使用 `node:sqlite` 与手写 SQL |
| 不使用 UI 组件库 | 避免引入来源复杂或带品牌限制的组件与资源，全部组件自研 |

## 5. 依赖变更流程

1. 新增依赖前检查其 `package.json` 的 `license` 字段；
2. 本地执行 `npm run license:check`；
3. 在 PR 中说明引入理由与许可证；
4. CI 失败时不得通过修改白名单绕过，需替换依赖或提交维护者评审。

## 6. 商标声明

Proxmox® 与 Proxmox VE® 是 Proxmox Server Solutions GmbH 的商标。VirtGate 与 Proxmox 无隶属关系，也未获得其背书；本项目仅通过公开 REST API 对接 PVE，不包含 PVE 的源码或闭源组件。
