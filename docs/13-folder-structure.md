# 13 — CẤU TRÚC THƯ MỤC

> **Phiên bản 3.0 (2026-06-10):** thêm modules `occupancy`/`quotes`/`billing`/`night-audit`; `web-guest` chuyển hẳn sang phụ lục phase-2 (không scaffold app chết); shadcn components chỉ ở `packages/ui` (app không giữ bản copy riêng); web-staff offline = **read-cache** (bỏ offline mutation queue).

## 1. Monorepo root

```
pms-homestay/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml
│   │   ├── deploy-staging.yml
│   │   ├── deploy-prod.yml
│   │   └── nightly-bench.yml        # k6 benchmark (11 §10) — không chạy per-PR
│   └── CODEOWNERS
├── .vscode/
├── apps/
│   ├── api/                    # NestJS backend
│   ├── web-admin/              # Next.js dashboard (ui/01)
│   └── web-staff/              # Next.js PWA nhân viên (ui/02)
├── packages/
│   ├── ui/                     # shadcn components — NGUỒN DUY NHẤT cho cả 2 app
│   ├── shared-types/           # Zod schemas + TS types
│   ├── pricing-engine/         # Pure pricing functions + roundVnd()
│   ├── eslint-config-pms/      # ESLint 9 flat config
│   └── tsconfig/
├── infra/
│   ├── docker/
│   │   ├── api.Dockerfile
│   │   ├── web.Dockerfile
│   │   └── docker-compose.dev.yml   # pg16 + redis7 + mailpit
│   ├── migrations-sql/         # SQL migrations — NGUỒN SỰ THẬT schema (ADR-0001)
│   │   ├── 0001_extensions.sql
│   │   ├── 0002_tenants_plans.sql
│   │   └── ...                 # mỗi file: bảng + RLS + composite FK + index + retention note
│   └── terraform/              # phase 2
├── docs/                       # Bộ tài liệu này (00–15, ui/, adr/)
├── scripts/
│   ├── seed-dev.ts
│   ├── seed-prod-required.ts   # subscription plans, vietnam_holidays
│   └── tenant-export.ts
├── .env.example
├── .nvmrc                      # 22
├── package.json · pnpm-workspace.yaml · turbo.json · tsconfig.base.json
└── README.md
```

## 2. `apps/api` — NestJS

```
apps/api/
├── src/
│   ├── main.ts                          # bootstrap, env zod, OTel init, Swagger
│   ├── app.module.ts
│   │
│   ├── core/                            # cross-cutting infrastructure
│   │   ├── config/                      # env.schema.ts, config.module.ts
│   │   ├── prisma/                      # PrismaService (client introspected — ADR-0001)
│   │   ├── redis/                       # connection thường + subscriber riêng (10 §4)
│   │   ├── bullmq/
│   │   ├── logger/                      # nestjs-pino + redact (11 §2)
│   │   ├── crypto/                      # ★ EncryptionService AES-GCM + HMAC blind index (ADR-0007)
│   │   ├── http/
│   │   │   ├── exceptions/              # RFC 7807 (base, booking-overlap, version-conflict, ...)
│   │   │   ├── filters/                 # http-exception, pg-error (23P01 → BOOKING_OVERLAP)
│   │   │   ├── interceptors/            # request-id, idempotency, audit
│   │   │   └── decorators/              # current-user, public, require-permissions, skip-tenant
│   │   ├── tenancy/
│   │   │   ├── tenant-resolver.middleware.ts
│   │   │   ├── with-tenant.ts           # ★ unit-of-work helper (ADR-0002) + CLS extension
│   │   │   └── tenant.guard.ts
│   │   ├── auth/                        # jwt.strategy, guards, permission cache (pv)
│   │   ├── audit/
│   │   └── outbox/
│   │       ├── outbox.service.ts        # publish(tx, event)
│   │       └── outbox-dispatcher.ts     # ★ claim SKIP LOCKED + LISTEN/NOTIFY + reclaim (10 §3)
│   │
│   ├── modules/
│   │   ├── tenants/
│   │   ├── billing/                     # ★ billing-lite SaaS: trial cron, plan-limit guard, thu phí tenant
│   │   ├── users/
│   │   ├── auth-public/                 # /auth/* endpoints
│   │   ├── properties/
│   │   ├── rooms/
│   │   ├── resources/                   # ★ bookable_resources + resource_members (ADR-0006)
│   │   ├── occupancy/                   # ★ OccupancyService — MỘT choke-point sinh/xoá occupancy rows
│   │   ├── rate-plans/
│   │   ├── quotes/                      # ★ persist + verify quote (07 §6)
│   │   ├── guests/                      # + scan-id (OCR), PII qua core/crypto
│   │   ├── bookings/
│   │   │   ├── dto/
│   │   │   ├── bookings.controller.ts
│   │   │   ├── bookings.service.ts      # createBookingTx — đường ghi duy nhất
│   │   │   ├── booking-status-machine.ts
│   │   │   ├── availability.service.ts  # đọc room_occupancy (06 §5)
│   │   │   ├── hold-expiry.cron.ts      # mỗi phút (06 §4)
│   │   │   └── tests/
│   │   ├── night-audit/                 # ★ no-show, PENDING expiry, OVERDUE, rollup, retention (09 §9)
│   │   ├── pricing/                     # wrap packages/pricing-engine + load vietnam_holidays
│   │   ├── invoices/                    # kind: DEPOSIT/STAY/MONTHLY_RENT/ADJUSTMENT
│   │   ├── monthly-billing/             # ★ billing-cycle thuê tháng + meter readings (09 §4.5)
│   │   ├── payments/
│   │   │   ├── payments.service.ts
│   │   │   ├── vietqr.service.ts
│   │   │   ├── payment-webhook.controller.ts   # Casso/SePay (09 §5)
│   │   │   └── reconciliation.service.ts       # matching đa tiêu chí + unmatched_payments
│   │   ├── assets/ · depreciation/ · expenses/
│   │   ├── reports/                     # pnl (đọc daily_property_stats), break-even
│   │   ├── channels/
│   │   │   ├── channel-resource-mappings.service.ts
│   │   │   ├── ical-pull.processor.ts · ical-pull.cron.ts
│   │   │   ├── ical-push.controller.ts  # GET /public/sync/ical/:token (ETag)
│   │   │   └── ical-parser.ts
│   │   ├── cleaning/
│   │   ├── events/                      # SSE controller + EventBusService (10 §4)
│   │   ├── notifications/               # email-resend, zns, sms, dispatcher queue
│   │   ├── compliance/                  # police-report, ocr (FPT), data-rights (export/erasure+legal-hold)
│   │   ├── storage/                     # s3.service (R2) + vn-storage.service (tier VN — ADR-0004)
│   │   ├── health/
│   │   └── platform/                    # platform admin API (platform_users auth riêng)
│   │
│   └── shared/                          # utils, constants, types
│
├── prisma/
│   └── schema.prisma                    # INTROSPECTED (db pull) — không sửa tay, không prisma migrate
├── test/
│   ├── e2e/
│   │   ├── auth.e2e-spec.ts
│   │   ├── tenant-isolation.e2e-spec.ts # gồm interleaved + composite FK cross-tenant
│   │   ├── booking-overbooking.e2e-spec.ts  # gồm WHOLE↔ROOM concurrent
│   │   ├── finance-deposit-refund.e2e-spec.ts
│   │   ├── outbox-dispatcher.e2e-spec.ts
│   │   └── ical-sync.e2e-spec.ts
│   ├── integration/
│   └── fixtures/                        # iCal feeds thật (Airbnb/Booking), bank webhook payloads
└── nest-cli.json · package.json · tsconfig.json
```

### Quy tắc module

- Mỗi module **chỉ export Service** — không export Repository.
- Cross-module: domain event (outbox) hoặc service injection — KHÔNG HTTP loopback.
- **Mọi thao tác sinh/xoá occupancy đi qua `OccupancyService`** — cấm module khác tự INSERT `room_occupancy`.
- **Mọi đọc/ghi field PII mã hoá đi qua `core/crypto`** — cấm tự decrypt.

## 3. `apps/web-admin` — Next.js (chi tiết page: [`ui/01-web-admin-pages.md`](ui/01-web-admin-pages.md))

```
apps/web-admin/
├── src/
│   ├── app/
│   │   ├── (auth)/login | register | forgot-password | reset-password
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx               # sidebar + PropertySwitcher + useEvents (SSE)
│   │   │   ├── page.tsx                 # Dashboard tổng quan
│   │   │   ├── calendar/                # ★ timeline phòng × ngày (màn hình lõi)
│   │   │   ├── bookings/ | guests/ | invoices/ | payments/
│   │   │   ├── properties/[id]/(settings|rooms|resources|blocks|rate-plans)
│   │   │   ├── expenses/ | assets/
│   │   │   ├── reports/(pnl|break-even|occupancy)
│   │   │   ├── channels/ | cleaning/ | notifications/
│   │   │   └── settings/(profile|users|billing|security|audit|compliance)
│   │   ├── layout.tsx · error.tsx · not-found.tsx
│   │   # KHÔNG có app/api proxy — FE gọi thẳng api.pmsapp.vn (SSE không được proxy qua Next)
│   │
│   ├── components/                      # composition từ @pms/ui — KHÔNG copy shadcn vào đây
│   │   ├── calendar/ (BookingCalendar, ResourceTimeline, DragLayer)
│   │   ├── booking/ (BookingForm, QuotePanel, CheckInDialog, CheckOutDialog, SwitchResourceDialog)
│   │   ├── invoice/ (InvoiceDetail, PaymentDialog, VietQrPanel, RefundDialog)
│   │   └── layout/ (Sidebar, TopBar, PropertySwitcher)
│   ├── hooks/ (useAuth, useEvents, useBookings, usePermissions, ...)
│   ├── lib/ (api-client.ts — fetch wrapper + refresh interceptor + If-Match; query-client; formatters)
│   ├── stores/ (auth.store, ui.store)
│   ├── i18n/ (vi.json, en.json)
│   └── middleware.ts                    # tenant subdomain → header, auth redirect
└── next.config.js · tailwind.config.ts (preset từ @pms/ui)
```

### Quy tắc Next.js

- Server Components mặc định; `'use client'` chỉ khi cần interactivity.
- Initial data: Server Component fetch BE; interactivity/refresh: TanStack Query.
- Form: react-hook-form + Zod resolver từ `@pms/shared-types` (cùng schema BE validate).
- Auth: access token in-memory; refresh cookie HTTP-only do BE set; CSRF double-submit.

## 4. `apps/web-staff` — Next.js PWA (chi tiết page: [`ui/02-web-staff-pages.md`](ui/02-web-staff-pages.md))

```
apps/web-staff/
├── src/
│   ├── app/(auth)/login
│   ├── app/(app)/
│   │   ├── today/                       # arrivals / departures / in-house
│   │   ├── checkin/[bookingId]/         # scan CCCD → OCR → verify (3 bước)
│   │   ├── checkout/[bookingId]/        # folio + thu tiền (QR/cash)
│   │   ├── cleaning/ · cleaning/[taskId]/
│   │   ├── rooms/                       # room status board (housekeeping)
│   │   └── profile/
│   ├── components/ (ScanIdCamera, PhotoUpload, OfflineBanner, ...)
│   ├── service-worker.ts                # Workbox: precache shell + runtime cache GET
│   └── hooks/useOfflineCache.ts         # ★ READ-CACHE ONLY: xem dữ liệu khi rớt mạng;
│                                        #   MUTATION yêu cầu online (disable nút + banner).
│                                        #   KHÔNG có offline mutation queue — sync conflict với
│                                        #   booking/occupancy là bài toán chưa cần ở MVP.
└── public/manifest.json · icons/
```

## 5. `packages/shared-types`

```
packages/shared-types/src/
├── booking.ts · invoice.ts · payment.ts · property.ts · room.ts · resource.ts
├── rate-plan.ts · quote.ts · guest.ts · auth.ts · tenant.ts · billing.ts
├── events.ts                            # DomainEvent types + event_type map (10 §2)
├── common.ts                            # Pagination, ApiError (RFC 7807), Money
└── index.ts
```

Mỗi file: Zod schema + `z.infer` type. BE validate request (nestjs-zod), FE validate form.

## 6. `packages/pricing-engine`

```
packages/pricing-engine/
├── src/
│   ├── hourly.ts · daily.ts · monthly.ts
│   ├── rules.ts                         # apply rate_plan_rules (priority, tie-break created_at)
│   ├── round.ts                         # ★ roundVnd() — hàm làm tròn DUY NHẤT toàn hệ thống
│   ├── holiday.types.ts                 # ★ CHỈ type — DATA ngày lễ ở bảng vietnam_holidays, truyền qua input
│   ├── timezone.ts                      # localDate/localTime theo property TZ (07 §4)
│   └── index.ts                         # quote(input, plan, holidays): Quote
└── tests/ (hourly, daily, monthly, timezone, rounding)
```

**Pure function** — không import NestJS, không chạm DB/Date.now ngầm. BE và FE dùng chung.

## 7. `packages/ui`

```
packages/ui/
├── src/components/ (button, dialog, table, form, calendar, date-range, money-input, ...)
├── src/lib/cn.ts
├── tailwind.config.ts                   # preset share — app extend, không tự định nghĩa token
└── package.json
```

> Đây là **bản duy nhất** của shadcn components. `web-admin`/`web-staff` import `@pms/ui`, không giữ `components/ui` copy riêng (2 bản copy = drift theme/behavior).

## 8. Import paths

```jsonc
{
  "paths": {
    "@/*": ["src/*"], "@core/*": ["src/core/*"], "@modules/*": ["src/modules/*"],
    "@pms/shared-types": ["../../packages/shared-types/src"],
    "@pms/pricing-engine": ["../../packages/pricing-engine/src"],
    "@pms/ui": ["../../packages/ui/src"]
  }
}
```

## 9. File naming

| Loại | Convention | Ví dụ |
|------|------------|-------|
| NestJS controller/service/module/guard | `<name>.<type>.ts` | `bookings.service.ts` |
| DTO | `<verb>-<entity>.dto.ts` | `create-booking.dto.ts` |
| Processor / Cron | `<name>.processor.ts` / `<name>.cron.ts` | `ical-pull.processor.ts` |
| React component / hook | `PascalCase.tsx` / `use<Name>.ts` | `BookingCalendar.tsx` |
| Test | `<name>.spec.ts` · `<name>.e2e-spec.ts` | `occupancy.service.spec.ts` |

## Phụ lục — `apps/web-guest` (PHASE 2, KHÔNG scaffold ở MVP)

Booking engine cho khách tự đặt: `/[tenant]/rooms`, `/[tenant]/book/...` (SSR cho SEO). Khi làm thật: cân nhắc **hosted booking page** nhẹ (1 trang/property nhúng được) trước khi build cả app — chi tiết để phase 2 quyết.
