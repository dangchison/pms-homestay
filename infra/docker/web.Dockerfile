# Next.js (web-admin | web-staff) — Next standalone output, build từ monorepo root:
#   docker build -f infra/docker/web.Dockerfile --build-arg APP=web-admin -t pms-web-admin .
#   docker build -f infra/docker/web.Dockerfile --build-arg APP=web-staff -t pms-web-staff .

ARG APP=web-admin

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
ARG APP
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/${APP}/package.json apps/${APP}/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/ui/package.json packages/ui/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/eslint-config-pms/package.json packages/eslint-config-pms/
RUN pnpm install --frozen-lockfile --filter @pms/${APP}...
COPY packages packages
COPY apps/${APP} apps/${APP}
RUN pnpm --filter @pms/shared-types build && pnpm --filter @pms/${APP} build

FROM node:22-slim AS runner
ARG APP
ENV NODE_ENV=production
ENV APP_DIR=apps/${APP}
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
# Chạy non-root (user `node` uid 1000 có sẵn) — Trivy DS-0002. chown khi COPY để
# Next standalone server ghi được .next/cache (ISR / image optimization) lúc chạy.
COPY --from=build --chown=node:node /app/apps/${APP}/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=build --chown=node:node /app/apps/${APP}/public ./apps/${APP}/public
USER node
EXPOSE 3000
CMD ["sh", "-c", "node ${APP_DIR}/server.js"]
