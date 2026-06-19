# API NestJS — build từ monorepo root:
#   docker build -f infra/docker/api.Dockerfile -t pms-api .
# TODO(task 8.x): tối ưu size bằng pnpm deploy --prod (cần xử lý prisma generate ở stage runner)

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
# Prisma engine cần openssl
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/pricing-engine/package.json packages/pricing-engine/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/eslint-config-pms/package.json packages/eslint-config-pms/
COPY apps/api/prisma apps/api/prisma
RUN pnpm install --frozen-lockfile --filter @pms/api...
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @pms/shared-types --filter @pms/pricing-engine build \
  && pnpm --filter @pms/api build

FROM build AS runner
ENV NODE_ENV=production
WORKDIR /app/apps/api
# Chạy non-root (node:22-slim đã có sẵn user `node` uid 1000) — Trivy DS-0002.
# Runtime chỉ đọc dist/node_modules (root-owned, world-readable) + ghi /tmp → đủ.
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
