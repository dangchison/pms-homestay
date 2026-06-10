# PMS Homestay — SaaS Multi-tenant

Hệ thống quản lý homestay / căn hộ dịch vụ / rent-to-rent tại Việt Nam.
Kiến trúc đầy đủ ở [`docs/`](docs/00-overview.md) — **đọc `00 → 01 → 13` + toàn bộ `adr/` trước khi code.**

## Trạng thái

Source base hoàn thành **Sprint 1 task 1.1–1.5** ([docs/14](docs/14-roadmap-tasks.md)):
monorepo, API skeleton (env zod, pino redact, RFC 7807, health, OTel), SQL-first migrations +
Prisma introspected client, `tenants`/`subscription_plans` + seed, **`withTenant` + RLS đã chứng minh
bằng test isolation interleaved**. Tiếp theo: task 1.6 (users/auth tables) → 1.7 (auth) → 1.8 (RBAC).

## Quickstart

```bash
nvm use && corepack enable          # Node 22 + pnpm 10
pnpm install
cp .env.example .env
pnpm db:up                          # PG16 + Redis7 + Mailpit (docker compose)
pnpm db:migrate                     # SQL migrations + prisma db pull + generate
pnpm db:seed:required && pnpm db:seed:dev
pnpm dev                            # api :3001 · web-admin :3000 · web-staff :3002
```

Kiểm tra: `curl localhost:3001/health/readiness` → `{"status":"ok"}` · Swagger (dev): `localhost:3001/api/docs` · Mailpit UI: `localhost:8025`.

| Lệnh | Tác dụng |
|---|---|
| `pnpm dev:api` | Chạy riêng API (watch) |
| `pnpm lint` / `typecheck` / `test` / `build` | Quality gates (CI chạy đúng các lệnh này) |
| `pnpm db:migrate` | `node-pg-migrate up` → `prisma db pull` → `prisma generate` |
| `pnpm db:reset` | Xoá volume → up → migrate → seed lại từ đầu |

## Cấu trúc (docs/13)

```
apps/      api (NestJS 11) · web-admin (Next 15) · web-staff (Next 15 PWA)
packages/  ui (shadcn — BẢN DUY NHẤT) · shared-types (Zod chung BE/FE)
           pricing-engine (pure fn + roundVnd) · eslint-config-pms · tsconfig
infra/     docker (compose dev, Dockerfiles) · migrations-sql (NGUỒN SỰ THẬT schema)
scripts/   seed-prod-required.ts · seed-dev.ts
docs/      00–16, ui/, adr/ — nguồn sự thật thiết kế
```

## Quy tắc bất di bất dịch (enforce bằng lint/CI — chi tiết: docs + ADR)

1. **Schema = SQL migrations** (`infra/migrations-sql/`). `schema.prisma` là sản phẩm introspect —
   KHÔNG sửa tay, KHÔNG `prisma migrate` ([ADR-0001](docs/adr/0001-orm-strategy.md)). CI fail nếu schema lệch DB.
2. **Mọi bảng tenant-scoped**: `tenant_id` + RLS qua `enforce_tenant_isolation()` + composite FK
   `(tenant_id, id)` + dòng retention ([ADR-0002](docs/adr/0002-rls-tenant-context-and-pooling.md), [ADR-0005](docs/adr/0005-tenant-isolation-composite-fk.md)).
3. **Mọi truy vấn tenant-scoped đi qua `withTenant(tx => ...)`** — lint cấm `this.prisma.<model>`
   trong `modules/`; **cấm external I/O trong transaction**.
4. **Một nguồn sự thật mỗi nghiệp vụ**: occupancy chỉ qua `OccupancyService` (task 2.1); booking chỉ qua
   `createBookingTx` (task 2.6); làm tròn tiền chỉ qua `roundVnd()`; PII chỉ qua `core/crypto` (task 2.5).
5. **API theo docs/05**: RFC 7807, `Idempotency-Key` cho POST quan trọng, `If-Match` cho PATCH,
   `23P01 → 409 BOOKING_OVERLAP`.
6. **App chạy bằng `app_user`** (non-superuser) — superuser bypass RLS; migrations chạy bằng owner
   qua `DATABASE_URL_MIGRATIONS`.

## Test

```bash
pnpm test                              # toàn bộ (cần docker stack đang chạy)
pnpm --filter @pms/api test            # di-smoke + RLS isolation/interleaved + health e2e
pnpm --filter @pms/pricing-engine test # roundVnd + timezone
```

## Tài liệu cốt lõi

[Tổng quan](docs/00-overview.md) · [Tech stack](docs/01-tech-stack.md) · [Multi-tenancy](docs/02-multi-tenancy.md) ·
[ERD 42 bảng](docs/03-database-erd.md) · [API conventions](docs/05-api-conventions.md) ·
[Folder structure](docs/13-folder-structure.md) · [Roadmap tasks](docs/14-roadmap-tasks.md) · [Sprint plan](docs/15-sprint-plan.md) · [ADR](docs/adr/README.md)
