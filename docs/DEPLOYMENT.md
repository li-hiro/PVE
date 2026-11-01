# 部署指南

本文覆盖生产部署、配置、备份升级与常见故障排查。初次体验建议直接使用 `bash scripts/deploy.sh`。

## 1. 环境要求

| 项目 | 最低 | 推荐 |
| --- | --- | --- |
| CPU | 2 核 | 4 核 |
| 内存 | 2 GB | 4 GB |
| 磁盘 | 20 GB | 50 GB + 审计留存空间 |
| Docker | 24+ | 最新稳定版，含 Compose v2 |
| Node.js（非容器部署） | 22.5+ | 24 LTS |
| 浏览器 | 支持 ES2022 的现代浏览器 | Chrome / Edge / Firefox 最新版 |

网络：门户与后端在同一网络内；后端需能访问各 PVE 集群的 `8006` 端口；浏览器需能访问门户端口。

## 2. Docker Compose 部署

### 2.1 准备

```bash
cp .env.example .env
```

必须修改：

```ini
JWT_SECRET=<openssl rand -hex 32 的输出>
ENCRYPTION_KEY=<另一个随机 32 字节串>
DEMO_MODE=false           # 生产关闭演示数据
WEB_PORT=8088             # 对外端口
CORS_ORIGINS=https://virtgate.example.com
```

### 2.2 启动

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f server
```

或使用脚本（自动生成密钥并等待健康检查）：

```bash
bash scripts/deploy.sh
bash scripts/deploy.sh --no-build     # 仅重启，不重建镜像
```

### 2.3 验证

```bash
curl -fsS http://127.0.0.1:8088/healthz
curl -fsS http://127.0.0.1:8080/api/v1/meta/health   # 容器内端口，需自行映射
```

浏览器访问 `http://<host>:8088`，使用初始管理员账号登录，随后立即修改密码并关闭演示模式。

## 3. 非容器部署

### 3.1 构建

```bash
npm run setup
npm run build
```

产物：`server/dist`（Node 服务）与 `web/dist`（静态文件）。

### 3.2 运行后端

```bash
NODE_ENV=production \
DATABASE_PATH=/var/lib/virtgate/virtgate.db \
JWT_SECRET=... \
ENCRYPTION_KEY=... \
node server/dist/main.js
```

建议使用 systemd 托管：

```ini
[Unit]
Description=VirtGate Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/virtgate
EnvironmentFile=/opt/virtgate/.env
ExecStart=/usr/bin/node server/dist/main.js
Restart=on-failure
User=virtgate
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

### 3.3 运行前端

将 `web/dist` 交给任意静态服务器，并反向代理 `/api` 到后端。项目已提供 [`web/nginx.conf`](../web/nginx.conf)，可直接复用。

## 4. 反向代理与 TLS

生产环境建议在门户前增加 TLS 终结（Nginx / Caddy / 企业网关）。示例：

```nginx
server {
    listen 443 ssl;
    server_name virtgate.example.com;

    ssl_certificate     /etc/ssl/virtgate.crt;
    ssl_certificate_key /etc/ssl/virtgate.key;

    location / {
        proxy_pass http://127.0.0.1:8088;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }
}
```

要点：

- WebSocket 控制台需要 `Upgrade` / `Connection` 头与较长的 `proxy_read_timeout`。
- 必须传递 `X-Forwarded-For`，否则审计记录的是代理 IP。
- 启用 HTTPS 后同步修改 `CORS_ORIGINS`。

## 5. PVE 侧准备

在每个 PVE 集群创建专用账号与 API Token，仅授予必要权限：

```bash
pveum user add virtgate@pve --comment "VirtGate service account"
pveum aclmod / -user virtgate@pve -role PVEAuditor
pveum aclmod /vms -user virtgate@pve -role PVEVMAdmin
pveum aclmod /storage -user virtgate@pve -role PVEDatastoreUser
pveum token add virtgate@pve token-virtgate --privsep 0
```

- Token 标识形如 `virtgate@pve!token-virtgate`。
- Token 密钥只显示一次，请立即填入平台表单；平台以 AES-256-GCM 加密保存。
- 若 PVE 使用自签证书，接入时可关闭 `verifyTls`；生产建议为 PVE 配置受信证书。
- 确认平台到 PVE 的 `8006` 端口可达，必要时放行防火墙。

## 6. 备份与恢复

数据全部位于 `DATABASE_PATH` 指向的 SQLite 文件（Docker 部署为命名卷 `virtgate-data`）。

```bash
# 容器内一致备份（推荐使用 SQLite 备份命令）
docker exec virtgate-server node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/app/data/virtgate.db');
db.exec(\"VACUUM INTO '/app/data/backup-\" + Date.now() + \".db'\");
"
docker cp virtgate-server:/app/data/<backup-file>.db ./backup.db
```

恢复：停止服务 → 用备份文件替换 `virtgate.db`（同时删除 `-wal` / `-shm`）→ 启动服务。

建议每周备份数据库，并按合规要求定期导出审计报表（CSV / JSON）异地留存。

## 7. 升级与回滚

```bash
git pull
bash scripts/deploy.sh          # 重新构建并滚动重启
```

数据库变更以幂等 DDL 追加，启动时自动执行，无需手工迁移。回滚：

```bash
docker compose down
git checkout <previous-tag>
bash scripts/deploy.sh --no-build
```

回滚前请先备份数据库；若新版本执行了不可逆的 DDL，需同时恢复备份。

## 8. 常见问题

| 现象 | 排查方向 |
| --- | --- |
| 容器启动即退出 | 查看 `docker compose logs server`，多半是缺少 `JWT_SECRET` / `ENCRYPTION_KEY` |
| 门户可开但接口 502 | Nginx 中 `server:8080` 是否可达；后端健康检查是否通过 |
| 集群显示离线 | 检查 API 地址、Token 权限、证书校验与 `8006` 端口连通性 |
| 控制台连不上 | 反向代理是否支持 WebSocket；`CONSOLE_TTL_SEC` 是否过短 |
| 创建资源提示配额超限 | 查看响应 `details` 中的超限维度，调整部门 / 用户配额 |
| 审计校验失败 | 检查是否有外部程序直接改写数据库；用导出报表定位断链序号 |
| 时间显示异常 | 浏览器与服务器时区差异；审计时间为 UTC ISO 字符串，前端按本地时区渲染 |

## 9. 安全加固清单

- [ ] 使用随机且独立的 `JWT_SECRET` 与 `ENCRYPTION_KEY`，定期轮换
- [ ] 关闭 `DEMO_MODE`，删除演示账号
- [ ] 首次登录后修改 `admin` 密码
- [ ] 门户仅在内网或 VPN 可达，或前置 TLS 与访问控制
- [ ] PVE 使用专用最小权限 Token，按集群隔离
- [ ] 定期备份数据库并将审计报表异地留存
- [ ] 监控 `/healthz` 与容器日志，接入企业告警通道
