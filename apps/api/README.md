# @pms/api

API **NestJS modular-monolith** của PMS Homestay — multi-tenant trên Postgres
**RLS**, SQL-first migrations + Prisma introspected client. Cổng `:3001`, prefix
`/api/v1` (health nằm ngoài prefix).

Bối cảnh kiến trúc: [`docs/00`](../../docs/00-overview.md) → [`13`](../../docs/13-folder-structure.md)
+ toàn bộ [`docs/adr/`](../../docs/adr). Quy ước API: [`docs/05`](../../docs/05-api-conventions.md).

## Chạy & kiểm thử

```bash
# Từ ROOT repo (cần PG + Redis: pnpm db:up)
pnpm dev                              # chạy cả 3 app (api :3001)
pnpm --filter @pms/api dev            # chỉ API (nest start --watch)

pnpm --filter @pms/api build          # nest build + tsc-alias
pnpm --filter @pms/api test           # vitest e2e (cần PG + Redis)
pnpm --filter @pms/api typecheck      # tsc --noEmit (gồm cả test/)
pnpm --filter @pms/api lint           # eslint src test
```

> ⚠️ **e2e chạy serial.** Dùng `pnpm --filter @pms/api test --no-file-parallelism`
> để có tín hiệu sạch (suite chạy chung DB `pms`, song song dễ flake do tranh CPU
> và row outbox/cleaning). **`typecheck` là thứ DUY NHẤT kiểm kiểu file `test/`**
> (vitest dùng esbuild không typecheck, nest build chỉ build `src/`) → CI có check
> `test/` nên luôn typecheck sau khi viết e2e.

## Cấu trúc `src/`

- **`core/`** — hạ tầng xuyên suốt (không nghiệp vụ): `config` (env zod fail-fast),
  `prisma` (+ `tenancy.withTenant` set RLS GUC), `redis`, `bullmq`, `auth`
  (guards/decorators RBAC), `http` (ZodValidationPipe, filter RFC 7807), `outbox`
  (dispatcher SKIP LOCKED + reclaim), `crypto` (AES-256-GCM PII, ADR-0007),
  `storage` (S3 presign), `mail`, `counters`, `logger` (pino redact), `otel`.
- **`modules/`** — nghiệp vụ theo domain: `auth-public`, `properties`, `rooms`,
  `resources`, `occupancy`, `rate-plans`, `pricing`, `bookings`, `guests`,
  `invoices`, `payments`, `expenses`, `assets`, `reports`, `channels`,
  `cleaning`, `notifications`, `events` (SSE), `audit`, `compliance`,
  `subscription`, `billing`, `tenant`, `users`, `night-audit`, `health`.
- **`shared/`**, **`types/`** — tiện ích + khai báo dùng chung trong API.
- **`main.ts`** boot · **`app.setup.ts`** pipeline dùng chung với e2e (prefix,
  pipe, filter, cookie, CORS) · **`openapi.ts`** sinh spec tĩnh (xem dưới).

## Database & migrations

**SQL-first**: viết DDL ở [`infra/migrations-sql/NNNN_*.sql`](../../infra/migrations-sql)
→ áp + introspect:

```bash
pnpm --filter @pms/api db:migrate     # = db:migrate:sql + db:pull + db:generate
```

Hai vai trò DB: `DATABASE_URL` = **`app_user`** (non-superuser, **chịu RLS** —
runtime app) · `DATABASE_URL_MIGRATIONS` = **`postgres`** (superuser — chạy
migration, sở hữu SQL function `SECURITY DEFINER`). Mọi truy cập bảng có RLS phải
qua `withTenant(tx => …)`; bảng gốc (`tenants`, `subscription_plans`) truy cập
prisma trực tiếp (eslint tenancy cấm `this.prisma.<model>` trong `modules/`).

## OpenAPI

```bash
pnpm --filter @pms/api build && pnpm --filter @pms/api openapi:export
```

Sinh [`docs/openapi.json`](../../docs/openapi.json) **tĩnh** bằng NestFactory
*preview mode* (không cần DB/Redis). Swagger UI chỉ bật ở **dev** tại
`/api/docs` (không expose schema ở prod — [`docs/11`](../../docs/11-observability-ops.md)).
Spec là **kho route** (path + method + bearer auth); body schema không sinh tự
động vì validate bằng Zod (`@pms/shared-types`), không phải class-validator.

## Quy ước cốt lõi

- **Tiền** = cột Prisma `BigInt` → đọc bằng `Number()`, ghi số thường; làm tròn
  `roundVnd` từ `@pms/pricing-engine`.
- **Lỗi**: validate → `400 VALIDATION_FAILED`; nghiệp vụ → `422`/`409`. Action
  POST (`/:id/dispose`…) cần `@HttpCode(200)`.
- **RBAC 2 pha**: `@RequirePermissions` + `PermissionsGuard` (tenant + permission
  version + role) → `authorizeOnProperty(property_id, perm)` (property lấy từ
  entity, chống IDOR).
- **Sự kiện**: `OutboxService.publish(tx, event)` **trong cùng tx** với mutation
  → dispatcher fan-out Redis/SSE + notification.
- **Scheduler/worker** chỉ chạy khi `ENABLE_SCHEDULERS=true`.

Vận hành sự cố: [`docs/17-oncall-runbook.md`](../../docs/17-oncall-runbook.md).
