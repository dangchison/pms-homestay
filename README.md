# PMS Homestay — SaaS Multi-tenant

Hệ thống quản lý homestay / căn hộ dịch vụ / rent-to-rent tại Việt Nam.
Kiến trúc đầy đủ ở [`docs/`](docs/00-overview.md) — **đọc `00 → 01 → 13` + toàn bộ `adr/` trước khi code.**

## Trạng thái

**✅ Roadmap MVP 50/50 — toàn bộ EPIC 1–8 đóng** (Backend 1–5/7/8 · Frontend 6 · Production-readiness 8).
Scope + acceptance: [`docs/14-roadmap-tasks.md`](docs/14-roadmap-tasks.md) · tiến độ thực: [`PROGRESS.md`](PROGRESS.md) · việc hoàn thiện/hardening sau MVP: [`docs/18-phase2-backlog.md`](docs/18-phase2-backlog.md).
Phần còn lại là **kích hoạt vận hành** (Sentry DSN, R2 backup, load-test staging) + hoàn thiện FE/e2e — xem docs/18.

- **Nền tảng & IAM** (EPIC 1): monorepo, API skeleton (env zod fail-fast, pino redact, RFC 7807,
  health, OTel), SQL-first migrations + Prisma introspect, `withTenant` + **RLS chứng minh bằng
  test interleaved**; auth Argon2id + refresh rotation + CSRF double-submit + 2FA TOTP; RBAC 2 pha.
- **Đặt phòng & tài chính** (EPIC 2–4): occupancy + chống overbooking (`createBookingTx` + EXCLUDE),
  pricing engine + quote, booking lifecycle (hold/check-in-out/switch), invoice/payment + VietQR +
  đối soát webhook, chi phí/tài sản/khấu hao, báo cáo P&L, **outbox + SSE realtime**, notifications,
  audit log (partition tháng), billing-lite SaaS, dọn phòng.
- **Kênh OTA & tuân thủ** (EPIC 5, 7): iCal pull/push 2 chiều, OCR CCCD (FPT.AI), báo cáo lưu trú
  công an (TT56), quyền dữ liệu NĐ13 (export/erasure/consent).
- **Giao diện** (EPIC 6): web-admin (lịch · đặt phòng · hoá đơn · báo cáo · settings) + web-staff
  PWA (today/rooms board · check-in 3 bước OCR · check-out).
- **Production-readiness** (EPIC 8 — đóng 6/6): partition lifecycle (8.5) · security audit
  IDOR/RLS/CSRF/2FA + scanner CI gitleaks/Trivy (8.4) · docs + runbook + OpenAPI (8.6) ·
  backup R2 + restore-drill (8.1) · monitoring/Sentry gated env (8.2) · load-test k6 (8.3).
  > Code sẵn; còn **kích hoạt ops** (Sentry DSN, R2 creds, staging cho load-test) — [`docs/18`](docs/18-phase2-backlog.md) P2-C.

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

### Tài khoản demo (sau `pnpm db:seed:dev`)

Tenant **`demo`** + 3 tài khoản theo vai trò, **mật khẩu chung `Demo@2026!`** — dùng để thử/giới thiệu sản phẩm.

> **Trước khi login web-admin trên localhost:** copy env FE rồi **restart** dev server (Next nội suy `NEXT_PUBLIC_*` lúc khởi động, đọc từ thư mục app — KHÔNG đọc root `.env`):
> ```bash
> cp apps/web-admin/.env.example apps/web-admin/.env.local   # có NEXT_PUBLIC_DEFAULT_TENANT_SLUG=demo
> cp apps/web-staff/.env.example  apps/web-staff/.env.local
> ```
> Thiếu bước này → login web-admin lỗi `TENANT_CONTEXT_MISSING` (không gửi `X-Tenant-Slug`). web-staff có ô nhập mã homestay nên gõ `demo` là được.

`.env.example` đã bật `NEXT_PUBLIC_DEMO_MODE=1` → trang login hiện **nút 1-chạm**: web-admin "Dùng thử với tài khoản demo" (vào `owner@demo.vn`), web-staff "Dùng thử nhanh" (Lễ tân / Buồng phòng) — partner/khách bấm là vào, không cần gõ. **Deploy tenant thật: bỏ `NEXT_PUBLIC_DEMO_MODE`** (ẩn nút); demo công khai để ở subdomain riêng `demo.pmsapp.vn` + đổi mật khẩu.

| Vai trò | Email | Dùng cho |
|---|---|---|
| OWNER | `owner@demo.vn` | **web-admin** :3000 (quản trị đầy đủ) |
| STAFF (lễ tân) | `letan@demo.vn` | **web-staff** :3002 (hôm nay / check-in-out) |
| HOUSEKEEPER (buồng phòng) | `buongphong@demo.vn` | **web-staff** :3002 (dọn phòng / room board) |

> Seed tạo sẵn 1 cơ sở demo **kèm dữ liệu mẫu** quanh "hôm nay" (8 phòng, ~17 đặt phòng đủ trạng thái: đang ở / đến / đi hôm nay / tương lai / giữ chỗ, 1 nguyên căn, 1 block bảo trì; 5 hoá đơn đã trả / trả một phần / quá hạn; 4 task dọn phòng; 31 ngày thống kê cho báo cáo) — để Lịch / Hôm nay / Hoá đơn / Báo cáo có dữ liệu thật ngay. Dữ liệu mẫu **idempotent**: chạy lại `pnpm db:seed:dev` sẽ reset rồi nạp lại bộ tươi (ngày tính theo `now()` nên luôn quanh hôm nay). Vẫn thêm phòng/đặt phòng qua UI bình thường. ⚠️ Đổi mật khẩu trước khi mở demo ra public.

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
docs/      00–18 (00 tổng quan · 17 on-call runbook · 18 Phase 2 backlog), openapi.json, ui/, adr/ — nguồn sự thật thiết kế
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

> **Thứ tự ưu tiên khi xung đột** (docs/00 §7): `adr/` > docs domain `00–13` + `ui/` > `14`/`15`. Chi tiết kỹ thuật nằm ở ADR; docs domain trỏ tới ADR, không lặp lại.

**Nền tảng:** [Tổng quan](docs/00-overview.md) · [Tech stack](docs/01-tech-stack.md) · [Multi-tenancy](docs/02-multi-tenancy.md) · [ERD](docs/03-database-erd.md) · [Auth & RBAC](docs/04-auth-rbac.md) · [API conventions](docs/05-api-conventions.md) · [Folder structure](docs/13-folder-structure.md)

**Domain:** [Overbooking](docs/06-overbooking-prevention.md) · [Pricing](docs/07-pricing-engine.md) · [Channel sync](docs/08-channel-sync.md) · [Finance](docs/09-finance-accounting.md) · [Realtime](docs/10-realtime-events.md) · [Compliance VN](docs/12-vietnam-compliance.md)

**Kế hoạch & vận hành:** [Roadmap tasks](docs/14-roadmap-tasks.md) · [Sprint plan](docs/15-sprint-plan.md) · [Product roadmap](docs/16-product-roadmap.md) · [Phase 2 backlog](docs/18-phase2-backlog.md) · [Observability & ops](docs/11-observability-ops.md) · [On-call runbook](docs/17-oncall-runbook.md)

**Tham chiếu:** [UI spec](docs/ui/00-ui-overview.md) · [OpenAPI](docs/openapi.json) · [ADR](docs/adr/README.md) · [Tiến độ](PROGRESS.md)

> README từng app/package: [`apps/api`](apps/api/README.md) · [`apps/web-admin`](apps/web-admin/README.md) · [`apps/web-staff`](apps/web-staff/README.md) · [`packages/*`](packages).
