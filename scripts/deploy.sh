#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# VirtGate 快速部署脚本（Docker Compose）
#
# 用法：
#   bash scripts/deploy.sh              # 构建并启动
#   bash scripts/deploy.sh --no-build   # 不重新构建，仅启动镜像
#
# 脚本会：
#   1. 检查 docker 与 compose 插件
#   2. 若无 .env，则从 .env.example 复制并生成随机的 JWT_SECRET / ENCRYPTION_KEY
#   3. 启动编排并等待健康检查
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

NO_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=1 ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数：$arg" >&2
      exit 1
      ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "未检测到 docker，请先安装 Docker Engine。" >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "未检测到 Docker Compose（v2 插件或 docker-compose）。" >&2
  exit 1
fi

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif command -v node >/dev/null 2>&1; then
    node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
  else
    echo "需要 openssl 或 node 来生成随机密钥。" >&2
    exit 1
  fi
}

if [ ! -f .env ]; then
  echo "==> 未发现 .env，基于 .env.example 生成"
  cp .env.example .env
  JWT_NEW="$(generate_secret)"
  ENC_NEW="$(generate_secret)"
  JWT_NEW="$JWT_NEW" ENC_NEW="$ENC_NEW" node -e "
    const fs = require('node:fs');
    let text = fs.readFileSync('.env', 'utf8');
    text = text.replace(/^JWT_SECRET=.*$/m, 'JWT_SECRET=' + process.env.JWT_NEW);
    text = text.replace(/^ENCRYPTION_KEY=.*$/m, 'ENCRYPTION_KEY=' + process.env.ENC_NEW);
    fs.writeFileSync('.env', text);
  "
  echo "==> 已写入随机 JWT_SECRET 与 ENCRYPTION_KEY，请按需修改 DEMO_MODE 等配置"
fi

WEB_PORT="$(grep -E '^WEB_PORT=' .env | tail -n 1 | cut -d= -f2 || true)"
WEB_PORT="${WEB_PORT:-8088}"

if [ "$NO_BUILD" -eq 1 ]; then
  echo "==> 启动 VirtGate（跳过构建）"
  $COMPOSE up -d
else
  echo "==> 构建并启动 VirtGate"
  $COMPOSE up -d --build
fi

echo "==> 等待服务健康检查"
READY=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${WEB_PORT}/healthz" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done

if [ "$READY" -ne 1 ]; then
  echo "服务未在预期时间内就绪，请运行：$COMPOSE logs --tail=80" >&2
  exit 1
fi

echo ""
echo "VirtGate 已就绪： http://127.0.0.1:${WEB_PORT}"
echo "健康检查：       http://127.0.0.1:${WEB_PORT}/healthz"
echo ""
echo "演示账号（DEMO_MODE=true 时可用）："
echo "  admin / Admin@12345          平台管理员"
echo "  alice / Demo@12345          部门管理员"
echo "  bob   / Demo@12345          运维操作员"
echo "  carol / Demo@12345          只读成员"
echo "  eve   / Demo@12345          合规审计员"
echo ""
echo "查看日志： $COMPOSE logs -f server"
echo "停止服务： $COMPOSE down"
