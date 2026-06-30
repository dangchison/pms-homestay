# 14 — ROADMAP & TASK LIST CHO AI CODING AGENT

> **Cách dùng:** mỗi task = 1 PR. Agent đọc task → implement → test → submit. Task xếp theo dependency. View theo sprint: [`15-sprint-plan.md`](15-sprint-plan.md).
>
> **Phiên bản 3.0 (2026-06-10):** mọi acceptance criteria đã **đồng bộ với docs + ADR** (bản cũ chứa pattern đã bị bác — middleware set_config, công thức paid sai, holidays hardcode…). **Thứ tự ưu tiên khi phát hiện lệch: `adr/` > docs `00–13`/`ui/` > file này.** Lệch → sửa file này trước, rồi mới code.
>
> **Track song song không-phải-code, khởi động NGAY Sprint 1** (lead time dài): ⚖️ data-residency + luật sư + provider VN (ADR-0004, chốt trước khi lưu CCCD thật) · 📣 Zalo OA/ZNS template · SMS brandname · hợp đồng FPT.AI · DPA template + đăng ký A05.

---

## EPIC 1 — Foundation (Tuần 1-2)

### TASK 1.1 — Setup monorepo
**Acceptance:**
- pnpm workspaces: 3 apps (`api`, `web-admin`, `web-staff`) + 4 packages (`ui`, `shared-types`, `pricing-engine`, `eslint-config-pms`) — **KHÔNG scaffold `web-guest`** (phase 2).
- Turborepo: `build`, `test`, `lint`, `typecheck`, `dev`. ESLint **9 flat config** + Prettier. TS strict toàn bộ. `.nvmrc` = **22**.
- CI GitHub Actions: lint + typecheck + build (xem `11` §8).

### TASK 1.2 — `apps/api` skeleton
**Depends:** 1.1
**Acceptance:**
- NestJS **11** chạy `pnpm dev:api` (localhost:3001). Pino + redact đa tầng (`11` §2). Env Zod fail-fast. OTel SDK init (exporter off).
- `GET /health/liveness|readiness|startup` (public trả status tối giản — `11` §5). Global exception filter RFC 7807. Request-ID middleware.
- Swagger `/api/docs` (dev).

### TASK 1.3 — PostgreSQL + SQL-first migrations + Prisma client
**Depends:** 1.2
**Acceptance:**
- Docker Compose dev: Postgres 16 + Redis 7. Migration tool **SQL thuần** (`node-pg-migrate`/`dbmate`) — [ADR-0001](adr/0001-orm-strategy.md).
- Migration 0001: extensions `btree_gist`, `pg_trgm`, `citext`, `pgcrypto` (**không** uuid-ossp — dùng `gen_random_uuid()`).
- `pnpm db:migrate` = chạy migration **+** `prisma db pull && prisma generate`; CI check introspection sạch.
- PrismaService inject được; `/health/readiness` check DB + Redis.

### TASK 1.4 — Schema: tenants + subscription_plans
**Depends:** 1.3
**Acceptance:**
- Migration tạo `tenants`, `subscription_plans` (`02` §3). Seed `pnpm db:seed:required`: 4 plans + tenant demo.
- Unit test connect + select.

### TASK 1.5 — Tenant resolution + RLS theo `withTenant`
**Depends:** 1.4
**Acceptance:**
- Middleware `TenantResolver`: subdomain / `X-Tenant-Slug` / JWT `tnt`; validate tenant active; decorator `@Public()`, `@SkipTenantScope()`.
- **Helper `withTenant(tenantId, fn, {readOnly?})`** ([ADR-0002](adr/0002-rls-tenant-context-and-pooling.md)): interactive tx, statement đầu set GUC LOCAL, `transactionOptions` tường minh; Prisma Client Extension + AsyncLocalStorage để service không truyền `tx` tay. **KHÔNG có middleware set_config rời** (autocommit → mất context; session-level → leak — đã kiểm chứng PG16).
- Lint rule: cấm gọi `prisma.` trần trong `modules/**` (phải qua CLS/withTenant); cấm external I/O trong `withTenant` (checklist + review).
- E2E: 2 tenant không thấy data nhau **+ test interleaved** (Promise.all đan xen trên pool nhỏ).

### TASK 1.6 — Schema: users + auth tables + RLS helper
**Depends:** 1.5
**Acceptance:**
- Migration: `users`, `user_property_roles`, `refresh_tokens`, `platform_users` (`03` §4.1–4.2) — RLS policy (template NULLIF) + **composite FK** + partial unique (email live).
- Helper SQL `enforce_tenant_isolation(table_name)` apply policy uniform — mọi migration sau dùng lại.
- Soft-delete default filter bằng **Prisma Client Extension** (không dùng `$use` — deprecated). Trigger `updated_at`.

### TASK 1.7 — Authentication module
**Depends:** 1.6
**Acceptance:**
- `POST /auth/register` (tenant + OWNER, trial 14 ngày) · `login` (+ bước TOTP nếu bật) · `refresh` (**rotation + reuse detection + grace window 60s** — `04` §2) · `logout`, `logout-all` · forgot/reset password · 2FA enable/verify · sessions list/revoke.
- Argon2id (m=65536,t=3,p=4); min 10 ký tự + check common passwords.
- Throttle **account-first** (5/15' account lock; IP 30/15' → captcha; `CF-Connecting-IP` — `04` §3).
- E2E full flow + double-refresh race (2 concurrent refresh → không logout-storm).

### TASK 1.8 — RBAC guard + permission cache
**Depends:** 1.7
**Acceptance:**
- `@RequirePermissions(...)` + `PermissionsGuard` (pha 1: tenant + pv + role-level — `04` §4).
- Service helper `authorizeOnProperty(user, propertyId, perm)` (pha 2 — gọi SAU khi load entity; property lấy **từ entity**).
- Permission cache Redis TTL 60s + `pv` (permission version) bump khi đổi role → token cũ bị từ chối ngay.
- E2E: STAFF property A gọi `PATCH /bookings/:id` của property B (cùng tenant) → **403** (test chống bypass).

---

## EPIC 2 — Core Domain (Tuần 3-5)

### TASK 2.1 — Property, Room, Bookable Unit + Occupancy
**Depends:** 1.8
**Acceptance:**
- Migration: `properties`, `rooms` (housekeeping_status, buffer_minutes, **không** rent_mode/price), `room_blocks`, `bookable_resources`, `resource_members`, **`room_occupancy`** (presence-based, EXCLUDE vô điều kiện, CHECK one-of — `03` §4.3, [ADR-0006](adr/0006-bookable-unit-model.md)).
- CRUD properties/rooms theo `05`; tạo room → auto-tạo resource `type=ROOM` + member.
- Endpoint cấu hình resource WHOLE (chọn các phòng thành viên).
- **`OccupancyService`** — choke-point duy nhất: insertForBooking/insertForBlock/deleteFor…/findOverlaps (buffer áp ở đây).
- `room_blocks` CRUD → sinh/xoá occupancy cùng tx. E2E: block trùng booking → 409.

### TASK 2.2 — Rate Plans + vietnam_holidays
**Depends:** 2.1
**Acceptance:**
- Migration: `rate_plans` (deposit_type/value, version), `rate_plan_rules`, **`rate_plan_resources`** (gán theo resource), **`vietnam_holidays`** (global, seed 2026–2027 + script cập nhật yearly).
- CRUD; bắt buộc 1 default plan per (property, mode); sửa giá → bump `rate_plans.version`.
- Validation: `effective_from < effective_to`; **từ chối 2 rule cùng priority chồng ngày**.

### TASK 2.3 — Pricing engine package
**Depends:** 1.1 (độc lập BE)
**Acceptance:**
- `packages/pricing-engine`: `quote(input, plan, holidays)` cho HOURLY/DAILY/MONTHLY theo `07` (bản 3.0).
- **Holidays đi qua INPUT — KHÔNG embed data lịch lễ trong package** (data ở bảng `vietnam_holidays`).
- **Mọi phép bucket ngày theo `propertyTimezone`** (test case 18:30 UTC = 01:30 VN hôm sau); fee sớm/trễ so sánh đủ giờ:phút; `roundVnd()` duy nhất.
- Unit test phủ toàn bộ bảng test `07` §8.

### TASK 2.4 — Quote endpoint (persist)
**Depends:** 2.2, 2.3
**Acceptance:**
- Migration bảng **`quotes`** (`03` §4.4). `POST /pricing/quote` → tính + **INSERT DB** (line_items, rate_plan_version, expires 15') → trả `quote_id`. **Không dùng Redis làm nơi lưu quote.**
- Cron dọn quote hết hạn >7 ngày (gắn vào night-audit sau ở 4.6).

### TASK 2.5 — Guests + PII encryption
**Depends:** 1.8
**Acceptance:**
- `core/crypto` **EncryptionService**: AES-256-GCM (key_id prefix) + HMAC blind index ([ADR-0007](adr/0007-pii-field-encryption.md)); env keys validate.
- Migration `guests` (`id_document_number_enc/_hash/_last4` — KHÔNG cột plaintext) + RLS + composite FK.
- CRUD; search `?q=` theo name (pg_trgm)/phone; search theo số giấy tờ = exact qua hash. Endpoint xem số đầy đủ riêng → decrypt + audit `READ_PII`. Blacklist endpoint.

### TASK 2.6 — Booking core
**Depends:** 2.1, 2.4, 2.5
**Acceptance:**
- Migration `bookings` (**resource_id, KHÔNG room_id, KHÔNG EXCLUDE** — `03` §4.5), `booking_status_history`; **đồng thời ALTER `room_occupancy` thêm composite FK `(tenant_id, booking_id) → bookings`** (FK này không thể tạo ở 2.1 vì `bookings` chưa tồn tại — 2.1 chỉ tạo FK tới `room_blocks`).
- `createBookingTx` (đường ghi duy nhất — `06` §3): advisory lock sorted member rooms → pre-check overlaps → insert booking + occupancy cùng tx → outbox event. Verify `quote_id` (re-calc, lệch → 409 PRICE_CHANGED).
- `POST /bookings` (Idempotency-Key) · `GET /bookings` filter property/status/from/to (property scope server-side) · `GET/:id` · `PATCH/:id` (If-Match, field theo status) · `POST /:id/cancel` (reason; xoá occupancy cùng tx).
- E2E: 2 concurrent cùng resource → 1 thành công 1 409; **concurrent WHOLE↔ROOM → chỉ 1 thành công**; cancel rồi đặt lại OK; PATCH version cũ → 409 VERSION_CONFLICT.

### TASK 2.7 — HOLD + expiry cron
**Depends:** 2.6
**Acceptance:**
- Tạo booking `HOLD` với `expires_at = now()+10'`; cron mỗi phút (partial index `idx_bookings_expiry`) → CANCELLED(HOLD_EXPIRED) + xoá occupancy.
- `POST /bookings/:id/confirm`: HOLD→PENDING (set `expires_at` = hạn cọc 24h, cấu hình tenant) hoặc OWNER force → CONFIRMED.

### TASK 2.8 — Check-in / Check-out / Switch resource
**Depends:** 2.7
**Acceptance:**
- `POST /:id/check-in` (status + actual_check_in; chỉ CONFIRMED) · `POST /:id/check-out` (actual_check_out; **xoá occupancy**; finalize STAY invoice — chờ 3.2 thì stub event) · `POST /:id/switch-resource` `{new_resource_id, reason}`: tx check availability → occupancy delete+reinsert → history + audit; sinh cleaning task phòng cũ.
- State machine tập trung `booking-status-machine.ts` — transition không hợp lệ → 422 `BOOKING_INVALID_STATUS`.

---

## EPIC 3 — Finance (Tuần 5-7)

### TASK 3.1 — Document counters
**Depends:** 1.8
**Acceptance:**
- Migration `document_counters`; `DocumentCounterService.next(tenantId, 'INV'|'BK', period)` — UPSERT + row lock, atomic.
- Test 100 concurrent → 100 số liên tục không gap. Booking code dùng service này (sửa 2.6 nếu cần).

### TASK 3.2 — Invoices: kind + deposit + state machine
**Depends:** 2.6, 3.1
**Acceptance:**
- Migration `invoices` (**kind**, billing_period, version, generated `balance_vnd`), `invoice_items` (+`DEPOSIT_APPLIED`, `ref_invoice_id`) — `03` §4.6.
- Trigger `total_vnd = SUM(items)`; items chỉ sửa khi DRAFT.
- **Luồng cọc** ([ADR-0003](adr/0003-financial-ledger.md) amendment): PENDING → issue DEPOSIT invoice theo `deposit_type/value` (NONE → skip); cọc PAID → booking auto-CONFIRMED.
- Check-out → STAY invoice: items từ quote snapshot + phụ thu + `DEPOSIT_APPLIED` âm.
- `POST /invoices/:id/void` (reason, giữ số); `POST /invoices` ad-hoc; ADJUSTMENT kind.
- E2E: booking có cọc 30% → confirm bằng payment cọc → checkout → STAY invoice cấn cọc đúng số dư.

### TASK 3.3 — Payments + VietQR
**Depends:** 3.2
**Acceptance:**
- Migration `payments` (partial unique idempotency **bằng CREATE UNIQUE INDEX**), `payment_attempts`.
- `POST /payments` (cash/transfer manual, Idempotency-Key) · `POST /payments/:id/refund` (reason, permission).
- **Trigger `paid_vnd` theo công thức ADR-0003** (SUCCEEDED + PARTIALLY_REFUNDED, trừ refunded) — test: hoàn một phần → paid/balance đúng.
- Auto chuyển invoice PARTIALLY_PAID/PAID; VietQR builder NAPAS 247 + `GET /invoices/:id/qr-image` (PNG, addInfo = booking_code).

### TASK 3.4 — Đối soát Casso/SePay (MVP)
**Depends:** 3.3
**Acceptance:**
- `POST /webhook/payment/:provider`: HMAC verify + dedup `webhook_events_received` + enqueue, trả 200 ngay.
- Worker matching **đa tiêu chí có confidence** (`09` §5): ≥80 auto-confirm → trigger invoice + emit `payment.received`; thấp → `unmatched_payments`.
- `GET/POST /payments/unmatched[/:id/resolve|ignore]` (permission `payment.reconcile`).
- Test mock provider: khớp tự động, ambiguous (2 booking cùng số tiền) → unmatched.

### TASK 3.5 — Assets & Depreciation
**Depends:** 2.1
**Acceptance:**
- Migration `assets`, `depreciation_entries`. CRUD.
- Cron monthly (gọi từ night-audit sau): bulk accumulated (1 query — không N+1); pro-rate tháng đầu; **tháng cuối = plug số dư** (accumulated cuối == nguyên giá − residual, test rounding); thanh lý giữa kỳ.
- `createMany skipDuplicates` — chạy lại không sinh đôi.

### TASK 3.6 — Operational Expenses + OTA commission auto
**Depends:** 2.8
**Acceptance:**
- Migration `operational_expenses` (+`source_booking_id`, partial unique OTA_COMMISSION). CRUD + recurring (cron monthly từ template).
- **Booking CHECKED_OUT → auto-sinh expense OTA_COMMISSION** từ `bookings.commission_vnd` (1 lần duy nhất); P&L chỉ đọc expenses.

### TASK 3.7 — Reports: P&L + Break-even (đọc rollup)
**Depends:** 3.3, 3.5, 3.6, 4.6
**Acceptance:**
- Migration `daily_property_stats`. `GET /reports/pnl` (quá khứ đọc rollup + hôm nay live — `09` §8); `GET /reports/break-even` 3 kịch bản.
- Doanh thu ghi nhận đúng nguyên tắc (invoice ISSUED+, loại VOID/DRAFT; cọc chưa cấn không phải doanh thu).
- Perf: P&L 1 tháng < 300ms (đọc rollup).

### TASK 3.8 — Monthly billing cycle (thuê tháng)
**Depends:** 3.2
**Acceptance:**
- Migration `monthly_meter_readings`. Endpoint ghi chỉ số (staff).
- Job ngày 1 (từ night-audit): mỗi booking MONTHLY CHECKED_IN → invoice `MONTHLY_RENT` (pro-rate /30 + điện nước kỳ trước; thiếu chỉ số → DRAFT + notification nhắc). Idempotent theo (booking, billing_period).
- E2E: booking 3 tháng → 3 invoices đúng pro-rate.

---

## EPIC 4 — Operations (Tuần 7-9)

### TASK 4.1 — Cleaning tasks
**Depends:** 2.8
**Acceptance:**
- Migration `cleaning_tasks` (version). Auto-sinh khi CHECKED_OUT (+ khi switch-resource cho phòng cũ). CRUD + assign; flow PENDING→IN_PROGRESS→COMPLETED→VERIFIED; ảnh before/after lên S3 (pre-signed); đổi `rooms.housekeeping_status` tương ứng (DIRTY→CLEANING→CLEAN).

### TASK 4.2 — Outbox v2 + SSE
**Depends:** 1.8
**Acceptance:**
- Migration `outbox_events` (status 4 giá trị + claimed_at + trigger `pg_notify` — `03` §4.10).
- `outbox.publish(tx, event)`; dispatcher: claim `FOR UPDATE SKIP LOCKED` → PROCESSING → dispatch (concurrency 10) → PROCESSED; **reclaim sweep** PROCESSING >60s; **LISTEN `outbox_new`** đánh thức (poll 5s fallback) — `10` §3.
- SSE `GET /events/stream`: **một** Redis subscriber/instance + EventBus in-process fan-out theo tenant + permission snapshot (TTL 5'); **không mở tx cho stream**; heartbeat 30s.
- E2E: tạo booking → client nhận event <500ms p95; kill worker giữa chừng → reclaim; 3 dispatcher × 1000 events → mỗi event xử lý đúng 1 lần; client dedup theo `event_id`.

### TASK 4.3 — Emit domain events
**Depends:** 4.2
**Acceptance:** mọi mutation quan trọng (bảng `10` §2) publish outbox trong tx; payload đúng schema `shared-types/events.ts`; test từng event.

### TASK 4.4 — Notifications
**Depends:** 4.3
**Acceptance:**
- Migration `notifications`. Queue BullMQ `notifications` (email/sms/zns/in_app), jobId dedup `event_id+channel+user`.
- Email: Resend + template MJML/Handlebars. ZNS: Zalo OA (template đã duyệt — track song song); SMS fallback qua brandname provider (eSMS/Stringee). In-app: insert + SSE.

### TASK 4.5 — Audit log
**Depends:** 1.8
**Acceptance:**
- Migration `audit_logs` **partition theo tháng** + RLS + append-only (INSERT/SELECT only). `AuditInterceptor` auto-log POST/PATCH/DELETE với **redact PII** trong before/after; action `READ_PII` từ EncryptionService path.
- `GET /audit-logs` filter (permission `audit_log.read`).

### TASK 4.6 — Night-audit job
**Depends:** 2.7, 3.2
**Acceptance:**
- BullMQ scheduled per tenant (02:00 giờ property): ① CONFIRMED quá giờ không đến → NO_SHOW (+ xoá occupancy, chính sách cọc) ② PENDING quá `expires_at` → CANCELLED(DEPOSIT_TIMEOUT) ③ invoice quá hạn → OVERDUE + event ④ rollup `daily_property_stats` ⑤ ngày 1: gọi 3.8 + 3.5 + recurring expenses ⑥ retention crons (matrix `03` §7).
- Idempotent (chạy lại không double); mỗi bước log + metric riêng.

### TASK 4.7 — Billing-lite SaaS
**Depends:** 1.8
**Acceptance:**
- Cron trial: `trial_ends_at` quá hạn → SUSPENDED (đọc được, không tạo booking/sync — guard check `tenants.status`); thanh toán → ACTIVE; 60 ngày SUSPENDED → CHURNED.
- **Plan-limit guard:** tạo property/room/user vượt `subscription_plans.max_*` → 422 `PLAN_LIMIT_REACHED` + CTA nâng gói.
- Trang billing tenant: gói hiện tại, usage, lịch sử thanh toán; thu phí = VietQR động (dùng lại hạ tầng 3.3, platform admin xác nhận) — chưa cần cổng thanh toán tự động.

---

## EPIC 5 — Channel Sync (Tuần 9-10)

### TASK 5.1 — Channels + Resource mappings
**Depends:** 2.1
**Acceptance:**
- Migration `channels` (secret trong config mã hoá — ADR-0007), **`channel_resource_mappings`** (map theo resource; last_event_count, last_pulled_at), `webhook_events_received`.
- CRUD + generate/regenerate `ical_push_token`.

### TASK 5.2 — iCal pull worker
**Depends:** 5.1, 2.6
**Acceptance:**
- Migration: `bookings.missing_sync_count`; bảng `sync_jobs`, `sync_logs`.
- BullMQ cron 15'/mapping; fetch+parse **ngoài withTenant**; query bookings **bounded** (`check_out >= now()-7d`); tạo/sửa qua `createBookingTx` (conflict 23P01 → log + `booking.overbooking_detected`, không auto-resolve).
- **Sanity-guard chống mất booking** (`08` §3): feed rỗng/teo >50% so `last_event_count` → skip cancellations + alert; chỉ hủy booking TƯƠNG LAI vắng mặt **≥2 lần liên tiếp** (missing_sync_count).
- E2E với fixture feed Airbnb thật: timezone, all-day, cancelled, feed-rỗng-không-hủy.

### TASK 5.3 — iCal push endpoint
**Depends:** 5.1
**Acceptance:**
- `GET /api/v1/public/sync/ical/:token`: busy của resource qua occupancy; **statuses PENDING/CONFIRMED/CHECKED_IN — KHÔNG gồm HOLD**; from now trở đi; **ETag + If-None-Match → 304**; rate limit 10/min/IP/token; không PII trong summary.

---

## EPIC 6 — Frontend (song song, theo `ui/`)

### TASK 6.1 — `web-admin` setup
**Depends:** 1.1 · **Acceptance:** Next 15 App Router + Tailwind 4 + `@pms/ui` (KHÔNG copy shadcn local) + TanStack Query v5 + Zustand + **bộ lib đã chốt** (`ui/00` §4.5: TanStack Table, dnd-kit, Recharts, lucide-react, sonner — không tự thêm lib UI khác); auth flow (login, refresh interceptor + CSRF, logout); layout sidebar + PropertySwitcher; SSE `useEvents` (dedup event_id + invalidate map + refetch on reconnect — `10` §4); i18n vi/en. Page inventory: [`ui/01`](ui/01-web-admin-pages.md) nhóm A1–A6, S1.

### TASK 6.2 — Calendar timeline
**Depends:** 6.1, 2.6 · **Acceptance:** **tự dựng grid** (CSS Grid + TanStack Virtual virtualize hàng + dnd-kit — KHÔNG dùng FullCalendar/Bryntum, `ui/00` §4.5); trục Y resources (group theo property), trục X ngày/giờ; data từ occupancy API; drag-drop đổi resource (If-Match; 409 → toast + revert); filter property/status; SSE live update; quick-create kéo chọn khoảng; virtualize mượt với 50 phòng × 30 ngày. Spec: [`ui/01`](ui/01-web-admin-pages.md) #C1 + wireframe.

### TASK 6.3 — Booking form + quote
**Depends:** 6.2, 2.4 · **Acceptance:** form RHF + Zod shared-types; live quote (debounce gọi `/pricing/quote`, hiện breakdown + cọc); guest picker (search hash/phone, tạo mới inline); submit Idempotency-Key; xử lý 409 PRICE_CHANGED (hiện giá mới xác nhận lại) + BOOKING_OVERLAP. Spec: [`ui/01`](ui/01-web-admin-pages.md) #B3.

### TASK 6.4 — Invoice & Payment UI
**Depends:** 6.1, 3.4 · **Acceptance:** invoice detail (items, trạng thái, kind badge); record payment dialog; **VietQR panel realtime** (hiện QR → nhận `payment.received` qua SSE → tick xanh); refund flow (confirm + reason); **màn đối soát unmatched payments** (match tay → resolve). Spec: [`ui/01`](ui/01-web-admin-pages.md) #F1–F4.

### TASK 6.5 — Reports dashboard
**Depends:** 6.1, 3.7 · **Acceptance:** P&L chart theo tháng; break-even 3 kịch bản; occupancy heatmap; export PDF/Excel. Spec: [`ui/01`](ui/01-web-admin-pages.md) #R1–R3.

### TASK 6.6 — `web-staff` PWA
**Depends:** 1.1, 2.8 · **Acceptance:** installable PWA; login; Today (arrivals/departures/in-house); check-in flow 3 bước (camera scan CCCD → OCR prefill → verify → save); check-out + thu tiền (QR/cash); cleaning list + task detail (ảnh, checklist); room board (housekeeping status). **Offline = read-cache only** (Workbox runtime cache GET; mutation disable khi offline + banner). Spec: [`ui/02`](ui/02-web-staff-pages.md).

### TASK 6.7 — Settings & quản trị tenant
**Depends:** 6.1, 4.7 · **Acceptance:** users & roles (mời, gán role per property, override grant/deny); billing (gói, usage, QR thanh toán); security (2FA, sessions); audit viewer; compliance (police report download, consents); channels & tokens. Spec: [`ui/01`](ui/01-web-admin-pages.md) nhóm S2–S7.

---

## EPIC 7 — Compliance VN (Tuần 10-12)

### TASK 7.1 — OCR CCCD
**Depends:** 2.5 · **Acceptance:** FPT.AI service (fetch native, timeout 15s, retry 1, circuit breaker; **gọi ngoài tx**); `POST /guests/scan-id` trả extracted — **không persist raw response**; ảnh upload pre-signed lên storage tier VN; fallback nhập tay.

### TASK 7.2 — Police report export
**Depends:** 2.8, 7.1 · **Acceptance:** `GET /compliance/police-report?property_id&from&to` → Excel template TT56; decrypt số giấy tờ theo **batch** + 1 audit READ_PII scope report; test data fake.

### TASK 7.3 — Data rights (NĐ13)
**Depends:** 2.5 · **Acceptance:** migration `data_processing_consents`; data-export (job stream → zip → signed link); **data-erasure có legal-hold matrix** (`12` §4 — giữ hồ sơ công an/hoá đơn/CCCD theo hạn luật, anonymize phần được phép); data-correction; cron annual anonymize guest không booking 5 năm.

---

## EPIC 8 — Production readiness (Tuần 12)

### TASK 8.1 — Backup automation
Backup theo phương án hosting (`11` §6: provider PITR hoặc pgBackRest WAL) + daily logical dump → R2 + cross-region weekly; **restore drill** script + runbook (đo RTO/RPO thật).

### TASK 8.2 — Monitoring + Alerting
Sentry (FE+BE, source maps) + Better Stack (logs/dashboards/uptime/status page); alert rules theo `11` §9 (gồm outbox lag, reclaim, unmatched payments, holidays-năm-sau).

### TASK 8.3 — Load test
k6 nightly: 100 concurrent users, 1000 bookings, SSE 500 connections; đạt budget `11` §10; document bottleneck.

### TASK 8.4 — Security audit
OWASP Top 10 + IDOR (đặc biệt: property-scope bypass — test 1.8/2.6 mở rộng); CSRF; Snyk + gitleaks + trivy zero high/critical; 2FA enforced OWNER/ACCOUNTANT; RLS interleaved pass; rate-limit verify sau CF.

### TASK 8.5 — Data lifecycle & partition verify
Partition audit_logs hoạt động (tạo partition tháng mới tự động + detach/archive >12 tháng); night-audit retention chạy đủ matrix `03` §7; alert khi partition kế tiếp chưa tồn tại.

### TASK 8.6 — Docs final
README mỗi app/package; OpenAPI export commit; runbook on-call (restore, reclaim outbox, conflict OTA, unmatched payments).

---

## EPIC 9 — Phase 3 / Product roadmap (docs/16)

> Sau MVP (EPIC 1–8) + Phase 2 (docs/18). Mỗi tính năng từ [`16`](16-product-roadmap.md) khi quyết định làm → thêm task ở đây (docs/16 §4). Một task = một PR.

### TASK 9.1 — Landlord statement (R2R) [docs/16 #14, Wave 1]
Báo cáo kỳ cho **chủ nhà gốc** của cơ sở rent-to-rent: doanh thu kỳ + chi phí vận hành + **tiền chủ nhà nhận** theo mô hình hợp đồng (thuê cố định HOẶC chia % doanh thu). Differentiator cho tệp R2R (Top-5 #3).
**Depends:** 3.7 (reports/P&L), 2.1 (properties)
**Acceptance:**
- Migration thêm `properties.landlord_revenue_share_bp INT NULL` (CHECK 0..10000; NULL = dùng mô hình thuê cố định `monthly_landlord_rent_vnd`). Forward-only, nullable (backward-compatible). Wire vào property create/update + response (`shared-types` `propertyFields` + `PropertyResponse` + `properties.service`).
- `GET /reports/landlord-statement?property_id&from&to` — perm `report.financial` + `authorizeOnProperty`; CHỈ cơ sở `is_rent_to_rent` (else 422 `NOT_RENT_TO_RENT`). Tái dùng doanh thu/chi phí của `getPnl` (rollup `daily_property_stats` + live hôm nay), `readOnly` tx.
- `settlement_model`: `REVENUE_SHARE` nếu `landlord_revenue_share_bp` set → payout = `round(revenue_total × bp / 10000)`; `FIXED_RENT` nếu chỉ có `monthly_landlord_rent_vnd` → payout = thuê tháng **prorate theo ngày overlap từng tháng** trong [from,to]; else `NONE` (payout 0).
- Response: property + landlord (name/phone/contract dates) + revenue (room/other/total) + `operating_cost_vnd` (chưa gồm RENT_LANDLORD để tránh trùng) + settlement_model + `landlord_payout_vnd` + occupancy context.
- e2e: revenue-share (bp) → payout đúng %; fixed-rent → prorate đúng (nguyên tháng = nguyên tiền; nửa tháng = 1/2); cơ sở không R2R → 422; thiếu `report.financial` (HOUSEKEEPER) → 403; cross-tenant → 404.

_(Follow-up: export Excel/PDF cho landlord — tái dùng builder reports/police-report; trang Landlord ở web-admin.)_

### TASK 9.2 — Tầng danh tính khách toàn cục (Global Person Identity) [docs/16]
Nhận diện **"cùng 1 khách" XUYÊN tenant** (đặt ở chủ A rồi ở chủ B) mà **KHÔNG lộ PII cross-tenant**: mỗi chủ vẫn cô lập dữ liệu khách (RLS), platform chỉ biết "cùng người / bị blacklist nơi khác". Khách KHÔNG phải tài khoản đăng nhập — chỉ là bản ghi danh tính.
**Depends:** 2.5 (guests + PII), 7.3 (data-rights)
**Acceptance:**
- Migration 0030: bảng **GLOBAL `persons`** (KHÔNG tenant_id, KHÔNG RLS) khoá `national_id_hash` (= `guests.id_document_number_hash`, HMAC toàn cục) — chỉ hash + counters phi-PII (`tenant_link_count`, `blacklisted_anywhere`), KHÔNG PII. `guests.person_id` FK ĐƠN nullable. Function **SECURITY DEFINER** `recompute_person_counters(uuid)` (đếm cross-tenant bypass RLS, chỉ ghi counter phi-PII).
- `GuestsService`: create/update có số giấy tờ → find-or-create person (`ON CONFLICT (national_id_hash)`) → set `person_id`; recompute sau mỗi write (create/update/blacklist/remove + data-erasure). Đổi giấy tờ → re-link + recompute person cũ & mới. `recompute` gọi qua `$executeRaw` (function trả void).
- `GET /guests/:id/platform-summary` (perm `booking.read`) → `{linked, is_returning_guest, blacklisted_elsewhere}` — CHỈ nhận diện, KHÔNG PII/booking/tenant/lý-do.
- Hành vi: cùng chủ → dedup prefill (sẵn có); khác chủ → chỉ nhận diện, chủ B tự quét lại CCCD. Người nước ngoài → hộ chiếu làm khoá (caveat đổi số/OCR). **Khai báo tạm trú NN = task riêng** (khác TT56).
- e2e: cùng giấy tờ 2 tenant → cùng person (`tenant_link_count=2`); B thấy `is_returning_guest` KHÔNG lộ PII; không giấy tờ → `person_id` null; blacklist A → B thấy `blacklisted_elsewhere` (không lý do) + un-blacklist đồng bộ ngược; re-link đổi giấy tờ; erase giữ person; cross-tenant 404.

_(Follow-up: `phone_hash` fallback; merge CCCD+hộ chiếu; consent-prefill; guest portal/account #8/#1; cron dọn person mồ côi.)_

---

## Checklist PR (tự review trước khi submit)

- [ ] Bảng mới: RLS policy (template NULLIF) + **composite FK** + index có tenant_id đứng đầu + partial unique nếu soft-delete + **dòng retention** (matrix `03` §7). _(CI tự kiểm: `test/integration/rls-coverage.spec.ts` — bảng có `tenant_id` thiếu FORCE RLS → đỏ; cross-tenant cố ý phải thêm vào NO_RLS_ALLOWLIST.)_
- [ ] Mutation: `withTenant` unit-of-work; **không external I/O trong tx**; Idempotency-Key cho POST tạo entity; `version`/If-Match cho entity sửa đồng thời.
- [ ] Booking/occupancy: mọi đường ghi qua `createBookingTx`/`OccupancyService` — không INSERT occupancy/booking chỗ khác.
- [ ] Tiền: BIGINT + `roundVnd()`; không công thức paid tự chế (trigger ADR-0003 là chuẩn).
- [ ] PII: qua `core/crypto`; không log PII; audit READ_PII khi decrypt.
- [ ] Error format RFC 7807; map 23P01 → 409 BOOKING_OVERLAP.
- [ ] Event: publish qua outbox trong tx (không emit trần).
- [ ] Test: concurrency nếu liên quan booking/payment (gồm RLS interleaved); coverage không giảm.
- [ ] FE: components từ `@pms/ui`; schema từ `shared-types`; xử lý 401/403/409/422 chuẩn (`ui/00` §6).

## Lưu ý cho AI agent

1. **Xung đột tài liệu:** `adr/` > docs `00–13`/`ui/` > file này. Phát hiện lệch → sửa file này trước (PR riêng), rồi code.
2. **Không chắc → đọc lại doc domain; vẫn không rõ → tạo issue `clarification-needed`, không đoán.**
3. Mỗi PR ≤ 1 migration. Migration forward-only, backward-compatible với code đang chạy.
4. Test data: faker-js seed cố định.
