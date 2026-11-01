# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# VirtGate 控制平面（Fastify + node:sqlite）
# 多阶段构建：仅将编译产物与生产依赖带入运行镜像。
# ---------------------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 移除开发依赖，减小运行镜像体积
RUN npm prune --omit=dev

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATABASE_PATH=/app/data/virtgate.db

WORKDIR /app

# 以非 root 用户运行，并预创建数据目录
RUN addgroup -S virtgate && adduser -S virtgate -G virtgate \
    && mkdir -p /app/data && chown -R virtgate:virtgate /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

USER virtgate
EXPOSE 8080
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
