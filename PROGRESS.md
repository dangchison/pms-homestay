# 📊 Tiến độ triển khai — PMS Homestay

> **Cập nhật:** 2026-06-11 · **Nguồn sự thật phạm vi:** [`docs/14-roadmap-tasks.md`](docs/14-roadmap-tasks.md) (task + acceptance) · [`docs/15-sprint-plan.md`](docs/15-sprint-plan.md) (kế hoạch 6 sprint).
> File này là **bản theo dõi sống** — cập nhật sau mỗi task hoàn thành. Trạng thái lấy theo **commit thật**, không tính việc đang dở.

**Chú thích:** ✅ xong (đã verify) · 🟡 đang làm / một phần · ⬜ chưa bắt đầu

---

## 1. Tổng quan nhanh

| Chỉ số | Trạng thái |
|---|---|
| **Sprint hoàn thành** | **1 / 6** · Sprint 2 🟡 đang làm (task 2.1–2.4 ✅) |
| **Task backend xong** | **12 / 50** (EPIC 1 + task 2.1–2.4) · ~24% |
| **Nền tảng FE** | 🟡 scaffold + design system xong; chưa nối API |
| **Chạy được gì** | API (health, auth, **property/room/resource/block + rate-plan/rule CRUD + `POST /pricing/quote`**), **pricing-engine (HOURLY/DAILY/MONTHLY)**, 2 web app (UI), DB + migrations + seed (gồm `vietnam_holidays`), CI |
| **Chất lượng** | 70/70 test API + **21 pricing-engine** xanh · lint/typecheck/build xanh · 3 theme ổn định |

### Demo được gì hôm nay
- **Backend auth thật chạy:** đăng ký tenant + OWNER (trial 14 ngày), đăng nhập Argon2id + khoá tài khoản, refresh rotation + grace, 2FA TOTP, quên/đặt lại mật khẩu, RBAC theo role + property — qua `http://localhost:3001/api/v1/auth/*`.
- **Cách ly tenant (RLS) đã chứng minh** bằng test interleaved chạy bằng `app_user`.
- **Domain nền (task 2.1) chạy thật:** CRUD cơ sở/phòng (tạo phòng → tự sinh resource `ROOM` + member), cấu hình **bán nguyên căn** (resource `WHOLE`), chặn phòng (`room_blocks`). **Chống overbooking ở tầng DB** đã chứng minh: EXCLUDE trên `room_occupancy` (presence-based) chặn cả chéo **WHOLE↔ROOM**, buffer dọn phòng, `'[)'` ranh giới — qua `OccupancyService` (choke-point duy nhất). PATCH phòng dùng If-Match (version).
- **Gói giá (task 2.2) chạy thật:** CRUD `rate_plans` (HOURLY/DAILY/MONTHLY, cọc, gán theo resource) + luật giá `rate_plan_rules` (mùa/cuối tuần/lễ) với **validate cấm 2 rule cùng priority chồng ngày**; bắt buộc 1 gói mặc định mỗi (cơ sở, chế độ); sửa giá tự **bump version** (phục vụ re-calc quote 2.4). `vietnam_holidays` đã seed 2026–2027 (nguồn lễ cho pricing).
- **Pricing engine (task 2.3) chạy thật:** `quote(input, plan, holidays)` cho 3 chế độ — **tính ngày theo timezone property** (test 18:30 UTC = 01:30 VN hôm sau ăn đúng ngày VN), áp rule lễ/cuối tuần theo priority, làm tròn `roundVnd` duy nhất. Pure-function, dùng chung BE/FE.
- **Báo giá persist (task 2.4) chạy thật:** `POST /pricing/quote` lấy gói giá + luật + ngày lễ từ DB, gọi engine, **lưu vào bảng `quotes`** (snapshot version + breakdown, hết hạn 15') trả `quote_id` — để khi tạo booking (2.6) re-calc so khớp, lệch → `409 PRICE_CHANGED`. Đêm lễ/cuối tuần áp đúng; thiếu gói → 422.
- **Giao diện:** `web-admin` (http://localhost:3000) — Dashboard (Modern Hospitality, KPI + sparkline), login/register/forgot/reset, sidebar/topbar, các trang placeholder; `web-staff` PWA (http://localhost:3002) — today/rooms/cleaning/profile/login. Hệ **design token 2 tầng + 3 theme** (light/dark/warm) đổi ổn định.
- **Hạ tầng dev:** Docker (PG16 + Redis7 + Mailpit), migration SQL-first + Prisma introspect, seed; CI GitHub Actions.

> ⚠️ Số liệu nghiệp vụ trên UI hiện là **placeholder (0/—)** vì domain (property/booking/hoá đơn) bắt đầu từ Sprint 2. FE chưa nối API thật (thuộc task 6.1).

---

## 2. Tiến độ theo Sprint (xem [docs/15](docs/15-sprint-plan.md))

| Sprint | Tuần | Chủ đề | Trạng thái |
|:--:|:--:|---|:--:|
| **1** | 1–2 | Nền tảng + multi-tenant isolation | ✅ **Xong** |
| **2** | 3–4 | Property / Room / Resource + Pricing | 🟡 **Đang làm** (2.1–2.4 ✅) |
| 3 | 5–6 | Booking core + Calendar | ⬜ |
| 4 | 7–8 | Finance + Realtime + Audit | ⬜ |
| 5 | 9–10 | Operations + Channel sync + Staff PWA + SaaS billing | ⬜ |
| 6 | 11–12 | Compliance VN + Production-ready | ⬜ |

---

## 3. Chi tiết theo EPIC / Task (xem [docs/14](docs/14-roadmap-tasks.md))

### EPIC 1 — Foundation ✅ (8/8)
- ✅ **1.1** Monorepo (pnpm + Turborepo, ESLint 9, TS strict, Node 22)
- ✅ **1.2** `apps/api` skeleton (env zod, pino redact, RFC 7807, request-id, health, OTel, Swagger)
- ✅ **1.3** PostgreSQL 16 + Redis 7 + migrations SQL-first (node-pg-migrate) + Prisma introspect
- ✅ **1.4** Schema `tenants` + `subscription_plans` + seed
- ✅ **1.5** Tenant resolution + RLS qua `withTenant` (test isolation interleaved)
- ✅ **1.6** Schema `users`/`user_property_roles`/`refresh_tokens`/`platform_users` + soft-delete extension
- ✅ **1.7** Auth module (register/login/refresh+grace/logout/forgot-reset/2FA/sessions + throttle)
- ✅ **1.8** RBAC guard + permission cache (pv) + `authorizeOnProperty`

### EPIC 2 — Core Domain 🟡 (4/8)
- ✅ **2.1** Property, Room, Bookable Unit (`bookable_resources`/`resource_members`) + `room_occupancy` (EXCLUDE presence-based) + **OccupancyService** (choke-point) + `room_blocks` CRUD. Đã bổ sung FK `user_property_roles(tenant_id, property_id) → properties` (hoãn từ 1.6). Migration `0004`; FK `room_occupancy → bookings` vẫn hoãn tới 2.6 (bookings chưa tồn tại).
- ✅ **2.2** Rate Plans (deposit_type/value, version, gán theo **resource**) + `rate_plan_rules` (validate **cấm 2 rule cùng priority chồng ngày**) + `rate_plan_resources` + `vietnam_holidays` (seed 2026–2027). Migration `0005`; bắt buộc **1 default per (property, mode)** (partial unique + service); sửa giá → **bump version**; effective_from < effective_to.
- ✅ **2.3** `packages/pricing-engine` — `quote()` HOURLY/DAILY/MONTHLY (docs/07): timezone-aware (bucket ngày theo property TZ, `Intl`), rules theo priority + tie-break created_at, holidays **qua input** (không hardcode), `roundVnd` duy nhất, cọc FIXED/PERCENT. Pure (không NestJS/DB). 21 unit test phủ bảng docs/07 §8.
- ✅ **2.4** `modules/pricing` + bảng `quotes` (migration `0006`): `POST /pricing/quote` → load plan/rules/holidays từ DB → engine tính → **INSERT quotes** (snapshot `rate_plan_version`, line_items, expires 15') → trả `quote_id`. Resolve gói theo resource (ưu tiên default) → fallback property default. `purgeExpired` cho night-audit 4.6. **Không Redis.**
- ⬜ **2.5** Guests + PII encryption *(EncryptionService đã có sẵn từ 1.7)* — **kế tiếp**
- ⬜ **2.6** Booking core (`createBookingTx`) · ⬜ **2.7** HOLD + expiry cron · ⬜ **2.8** Check-in/out / switch resource

### EPIC 3 — Finance ⬜ (0/8)
- ⬜ 3.1 Document counters · 3.2 Invoices (kind/deposit/state machine) · 3.3 Payments + VietQR · 3.4 Đối soát Casso/SePay
- ⬜ 3.5 Assets & Depreciation · 3.6 Expenses + OTA commission · 3.7 Reports P&L/break-even · 3.8 Billing tháng

### EPIC 4 — Operations ⬜ (0/7)
- ⬜ 4.1 Cleaning · 4.2 Outbox v2 + SSE · 4.3 Emit events · 4.4 Notifications · 4.5 Audit log · 4.6 Night-audit · 4.7 Billing-lite SaaS

### EPIC 5 — Channel Sync ⬜ (0/3)
- ⬜ 5.1 Channels + resource mappings · 5.2 iCal pull · 5.3 iCal push

### EPIC 6 — Frontend 🟡 (nền tảng xong, chưa nối API)
- 🟡 **6.1** `web-admin` setup — ✅ scaffold + layout + sidebar/topbar + login/register/forgot/reset + Dashboard redesign + **design token 2 tầng/3 theme**; ⬜ nối API auth, `useEvents` (SSE), data hooks TanStack Query
- ⬜ **6.2** Calendar timeline · ⬜ **6.3** Booking form + quote · ⬜ **6.4** Invoice & Payment UI · ⬜ **6.5** Reports dashboard
- 🟡 **6.6** `web-staff` PWA — ✅ shell + trang tĩnh (today/rooms/cleaning/profile/login) + manifest; ⬜ Workbox/offline cache, nối API, camera/OCR check-in
- ⬜ **6.7** Settings & quản trị tenant (users/billing/audit/compliance + ThemeSwitcher)

### EPIC 7 — Compliance VN ⬜ (0/3)
- ⬜ 7.1 OCR CCCD · 7.2 Police report export · 7.3 Data rights (NĐ13)

### EPIC 8 — Production readiness ⬜ (0/6)
- ⬜ 8.1 Backup · 8.2 Monitoring/Alert · 8.3 Load test k6 · 8.4 Security audit · 8.5 Partition/retention verify · 8.6 Docs/runbook
- *(Đã đặt nền sẵn: Dockerfile api/web, CI lint/typecheck/test/build + gitleaks + introspection-clean gate)*

---

## 4. Việc kế tiếp (đề xuất thứ tự)

1. ✅ ~~Task 2.1, 2.2, 2.3, 2.4~~ — **đã xong** (xem EPIC 2).
2. **Task 2.5** — Guests + PII (mã hoá `id_document` qua `EncryptionService` đã có + blind index HMAC; search trgm theo tên/phone).
3. **Task 2.6 → 2.7 → 2.8** — Booking core (`createBookingTx`, verify quote) → HOLD + expiry cron → check-in/out + switch resource. *(2.6 ALTER `room_occupancy` thêm FK → bookings.)*
4. Song song: **Task 6.1** nối API thật cho `web-admin` (auth client + SSE hook) để Dashboard hiển thị số liệu sống.

---

## 5. Lịch sử commit

| Commit | Nội dung |
|---|---|
| `d1158d1` | Hệ design token 2 tầng theme-stable + redesign Dashboard (Modern Hospitality) |
| `abdf7e9` | Tạo 3 trang auth còn thiếu (register/forgot/reset) — hết link 404 |
| `9864673` | Fix lỗi pnpm dev (tsup watch) + nâng UI theo design system |
| `9d9b892` | Hoàn thành Sprint 1 — users/auth schema, auth module, RBAC (1.6–1.8) |
| `ce91db9` | Scaffold monorepo source base (1.1–1.5) |

---

## 6. Cách chạy nhanh

```bash
pnpm install
pnpm db:up                              # Docker: PG16 + Redis7 + Mailpit
pnpm db:migrate && pnpm db:seed:required && pnpm db:seed:dev
pnpm dev                                # api :3001 · web-admin :3000 · web-staff :3002
```
Truy cập: **Dashboard** http://localhost:3000 · **Staff** http://localhost:3002 · **API** http://localhost:3001/health/liveness · **Mail** http://localhost:8025
