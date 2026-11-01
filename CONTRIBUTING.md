# 贡献者指南

感谢你愿意参与 VirtGate。本文说明本地开发环境、代码规范、测试要求与提交方式，帮助你的改动尽快被合并。

## 行为准则

- 尊重所有参与者，讨论聚焦技术问题。
- 不提交任何来自闭源项目或强传染许可证（GPL / AGPL / LGPL / MPL / EPL / BUSL 等）的代码、资源与依赖。
- 不复制其他同类项目的架构设计、功能逻辑或实现代码；借鉴思路时请用自己的实现并注明参考来源。

## 环境准备

| 工具 | 版本 |
| --- | --- |
| Node.js | 24+（最低 22.5，`node:sqlite` 依赖） |
| npm | 10+ |
| Docker（可选） | 24+，含 Compose v2 |

```bash
git clone <your-fork-url> virtgate
cd virtgate
npm run setup          # 安装 server 与 web 依赖
cp .env.example .env   # 本地开发环境
```

开发运行：

```bash
npm run dev:server     # 控制平面 :8080
npm run dev:web        # 门户 :5173，自动代理 /api 到后端
```

## 项目结构约定

- `server/src/modules/*`：按领域拆分的仓储层，只负责 SQL 与数据映射，不写业务规则。
- `server/src/services/*`：业务规则与编排（权限、配额、审计、异常检测）。写操作应走 `operation-pipeline` 或显式调用 `recordAudit`。
- `server/src/routes/*`：HTTP 层，负责参数校验（zod）、权限声明与响应信封，不写复杂业务。
- `server/src/pve/*`：虚拟化后端接入，业务层只依赖 `ClusterProvider` 接口。
- `web/src/pages/*`：页面级组件；`web/src/components/*`：可复用组件；`web/src/lib/*`：请求、认证、格式化。
- `web/src/styles.css`：手写设计系统，新增样式请复用 CSS 变量与既有类名，避免引入 CSS 框架。

## 代码规范

- 全部使用 TypeScript，服务端保持 `strict` 无错误；禁止 `any` 逃逸（必要时用 `unknown` 并做收窄）。
- 注释解释"为什么"，不解释"是什么"；对外导出的函数与接口保持简洁的中文说明。
- 服务端文件使用 ESM（`.js` 后缀导入），路由统一返回 `{ data }` 或 `{ data, meta }` 信封。
- 前端数据请求统一走 `lib/api.ts`，错误提示由 `lib/use-api.ts` 的 `errorMessage` 处理。
- 新增权限点必须同步到 `server/src/modules/rbac/catalog.ts`，否则前端权限矩阵不可见。
- 新增配置项必须同步到 `server/src/config.ts`、`.env.example`、`docker-compose.yml` 与 `docs/DEPLOYMENT.md`。

## 测试要求

```bash
npm run typecheck
npm run test:server
npm run test:web
npm run build
npm run license:check
```

- 新增服务端逻辑需补充 `server/tests/unit` 或 `server/tests/integration` 用例。
- 新增前端工具函数或通用组件需补充 Vitest 用例。
- 涉及权限、配额或审计的改动必须覆盖正向与越权 / 超额两类场景。
- CI 会执行上述全部命令，任何一项失败都会阻止合并。

## 提交与 Pull Request

提交信息采用 Conventional Commits：

```
feat(quota): 支持按用户覆盖部门配额
fix(audit): 修正区间校验的边界序号
docs(readme): 补充 PVE Token 创建步骤
```

PR 请包含：

1. 变更目的与背景（关联 Issue 编号）；
2. 主要实现思路与取舍；
3. 验证方式（执行的命令、关键场景）；
4. 涉及界面变更时附截图；
5. 是否引入新依赖，并说明其许可证（必须为 MIT / Apache-2.0 / BSD / ISC 等宽松许可证）。

提交前请确保：

- [ ] `npm run typecheck` 通过
- [ ] `npm run test` 通过
- [ ] `npm run build` 通过
- [ ] `npm run license:check` 无违规
- [ ] 新增 / 修改行为已写入对应文档
- [ ] 未提交 `.env`、数据库文件或任何密钥

## 依赖引入策略

引入新依赖前请确认：

1. 许可证属于 MIT、Apache-2.0、BSD-2/3-Clause、ISC、CC0 等宽松协议；
2. 能通过 `node scripts/license-check.mjs`（白名单见脚本内 `ALLOWED`）；
3. 不引入运行时闭源服务或需要商业授权的组件；
4. 优先使用标准库与现有依赖，避免为单一功能引入大型框架。

若确需新增白名单之外的许可证，请在 PR 中单独说明并等待维护者评审，不要自行修改白名单绕过检查。

## 发布流程（维护者）

1. 更新 `CHANGELOG`（如启用）与版本号（`package.json`、镜像标签）；
2. 全量执行测试、构建与许可证审计；
3. 打标签 `vX.Y.Z` 并推送；
4. 发布镜像与 Release Notes，附升级与回滚说明。

## 许可证

提交代码即表示你同意以 [Apache License 2.0](LICENSE) 授权你的贡献。
