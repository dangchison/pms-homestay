# 15 — SPRINT PLAN (MVP 12 tuần)

> **Mục đích:** view theo sprint "**mỗi giai đoạn cho ra hạng mục gì**" (demo được). Đây là view lập kế hoạch trên nền [`14-roadmap-tasks.md`](14-roadmap-tasks.md) (nguồn sự thật task + acceptance — bản 3.0 đã đồng bộ ADR/docs) — khi lệch, sửa theo `14`.

## Giả định & quy ước

- **Nhịp:** sprint 2 tuần × 6 = 12 tuần MVP. **Đội giả định:** ~2 BE + 1–2 FE + 1 DevOps (part-time). Đội nhỏ hơn → giãn timeline, thứ tự phụ thuộc không đổi.
- **DoD mỗi sprint:** test xanh (unit+integration+e2e), migration forward-only, coverage không giảm, qua checklist PR (`14`).
- **Track song song (không-phải-code) — khởi động NGAY Sprint 1** (lead time dài):
  - ⚖️ **Data residency** ([ADR-0004](adr/0004-data-residency.md)): luật sư + đánh giá provider VN. **Chốt trước khi lưu CCCD thật (Sprint 6).**
  - 📣 Zalo OA/ZNS (verify + duyệt template) · SMS brandname · hợp đồng FPT.AI · DPA template + đăng ký A05.

## Sprint-at-a-glance

| Sprint | Tuần | Chủ đề | Hạng mục demo được |
|:------:|:----:|--------|---------------------|
| **1** | 1–2 | Nền tảng + isolation | Đăng ký/đăng nhập tenant, RBAC, cách ly tenant đã chứng minh (interleaved) |
| **2** | 3–4 | Property/Room/Resource + Pricing | Quản lý cơ sở/phòng/**nguyên căn**, gói giá + báo giá 3 chế độ, admin login |
| **3** | 5–6 | Booking core + Calendar | **Đặt phòng end-to-end** chống overbook (cả WHOLE↔ROOM), HOLD, check-in/out, calendar |
| **4** | 7–8 | Finance + Realtime + Audit | **Luồng tiền end-to-end**: cọc → confirm → checkout cấn cọc; **VietQR tự đối soát**; SSE; audit |
| **5** | 9–10 | Operations + Sync + Staff PWA | Night-audit, billing tháng, P&L/break-even, dọn phòng, **iCal 2 chiều**, app nhân viên, billing-lite SaaS |
| **6** | 11–12 | Compliance + Production-ready | OCR CCCD, báo cáo lưu trú, quyền dữ liệu, backup/monitor/load-test/security — **go-live** |

---

## Sprint 1 (Tuần 1–2) — Nền tảng & Multi-tenant isolation
**Mục tiêu:** khung chạy được + tầng cách ly **đúng ngay từ đầu** (sửa sau là migrate dữ liệu thật).

- **Backend:** `1.1` monorepo (Node 22/Nest 11, không web-guest) · `1.2` API skeleton (pino redact, env zod, OTel, health, RFC7807) · `1.3` PG16+Redis + **SQL-first migrations** ([ADR-0001](adr/0001-orm-strategy.md)) · `1.4` tenants/plans · `1.5` **`withTenant` unit-of-work** ([ADR-0002](adr/0002-rls-tenant-context-and-pooling.md)) · `1.6` users/auth tables (composite FK [ADR-0005](adr/0005-tenant-isolation-composite-fk.md), partial unique, `platform_users`) · `1.7` auth (rotation + **grace window**, throttle CGNAT) · `1.8` RBAC (resource-based + permission cache `pv`).
- **Demo:** đăng ký tenant + OWNER, login/refresh/logout, 2FA; phân quyền theo role+property; **test isolation interleaved + composite FK cross-tenant xanh**.
- **Rủi ro:** sprint rủi ro nhất về *thực thi* RLS+pooling — làm `withTenant` + chọn pooler tương thích TRƯỚC mọi thứ khác.

## Sprint 2 (Tuần 3–4) — Property/Room/Resource + Pricing
**Mục tiêu:** dữ liệu nền + mô hình bookable unit + định giá.

- **Backend:** `2.1` property/room + **bookable_resources/resource_members/room_occupancy + OccupancyService** ([ADR-0006](adr/0006-bookable-unit-model.md)) · `2.2` rate plans (theo resource) + **`vietnam_holidays`** · `2.3` pricing-engine (**timezone-aware**, holidays qua input, roundVnd) · `2.4` quote **persist DB** · `2.5` guests + **PII encryption** ([ADR-0007](adr/0007-pii-field-encryption.md)).
- **Frontend:** `6.1` web-admin setup (auth, layout, SSE hook sẵn).
- **Demo:** tạo cơ sở/phòng, cấu hình **bán nguyên căn hay từng phòng**; gói giá mùa/lễ/cuối tuần + xem trước giá 3 chế độ (đúng giờ VN); dashboard login.

## Sprint 3 (Tuần 5–6) — Booking core + Calendar
**Mục tiêu:** trái tim hệ thống.

- **Backend:** `2.6` booking qua `createBookingTx` (occupancy + quote verify + If-Match + Idempotency) · `2.7` HOLD + expiry cron · `2.8` check-in/out + switch-resource + state machine · `3.1` document counters.
- **Frontend:** `6.2` calendar timeline (drag-drop) · `6.3` booking form (live quote, guest picker).
- **Demo:** đặt phòng end-to-end chống trùng thật ở DB (**kể cả nguyên căn ↔ phòng lẻ đồng thời**), giữ chỗ HOLD 10', check-in/out, đổi phòng kéo-thả trên calendar.
- **DoD đặc thù:** e2e 2 concurrent → 1 thành công 1×409; WHOLE↔ROOM → chỉ 1; optimistic-lock 409.

## Sprint 4 (Tuần 7–8) — Finance + Realtime + Audit
**Mục tiêu:** dòng tiền đúng (cọc, refund) + realtime + audit.

- **Backend:** `3.2` invoices kind + **deposit invoice** (PENDING→cọc→auto-CONFIRMED; checkout cấn cọc) · `3.3` payments + VietQR + **công thức paid đúng** · `3.4` **đối soát Casso/SePay (MVP)** + unmatched · `4.2` **outbox v2** (SKIP LOCKED + reclaim + NOTIFY) + SSE · `4.3` emit events · `4.5` audit (partition + redact).
- **Frontend:** `6.4` invoice/payment UI (**QR quét → tick xanh realtime**, refund, màn đối soát unmatched).
- **Demo:** booking → cọc qua QR → tự confirm trong vài giây → checkout cấn cọc → refund một phần **số dư vẫn đúng**; mọi máy thấy thay đổi tức thì (SSE); audit log tài chính.
- **DoD đặc thù:** test paid/balance khi refund; outbox: kill worker → reclaim, 3 dispatcher không double-send.

## Sprint 5 (Tuần 9–10) — Operations + Channel sync + Staff PWA + SaaS billing
**Mục tiêu:** vận hành hằng ngày + OTA + app nhân viên + thu tiền SaaS.

- **Backend:** `4.6` **night-audit** (no-show, PENDING expiry, OVERDUE, rollup, retention) · `3.8` **billing tháng** (meter readings + MONTHLY_RENT) · `3.5` depreciation · `3.6` expenses + OTA commission auto · `3.7` reports (đọc rollup) · `4.1` cleaning · `4.4` notifications (ZNS/email) · `4.7` **billing-lite SaaS** (trial cron, plan limits, thu phí VietQR) · `5.1` channels + resource mappings · `5.2` iCal pull (**sanity-guard**) · `5.3` iCal push (no HOLD, ETag).
- **Frontend:** `6.5` reports dashboard · `6.6` web-staff PWA (read-cache offline) · `6.7` settings (users/billing/audit/compliance).
- **Demo:** khách tháng nhận hoá đơn điện nước tự động; no-show tự xử lý lúc 2h sáng; P&L/break-even 3 kịch bản; đồng bộ Airbnb/Booking 2 chiều (feed lỗi không hủy nhầm); app nhân viên cài như app; tenant hết trial bị suspend + thanh toán mở lại.
- **Lưu ý tải:** sprint nặng nhất — `4.7`/`6.7` có thể trượt sang đầu Sprint 6 mà không vỡ phụ thuộc.

## Sprint 6 (Tuần 11–12) — Compliance VN + Production-ready
**Mục tiêu:** pháp lý + go-live.

- **Compliance:** `7.1` OCR CCCD (không persist raw) · `7.2` police report (decrypt batch + audit) · `7.3` data rights (**legal-hold**) — ⚖️ điều kiện: ADR-0004 đã Accepted (residency chốt).
- **Readiness:** `8.1` backup + restore drill · `8.2` monitoring/alert/status page · `8.3` load test k6 · `8.4` security audit (IDOR property-scope, CSRF, RLS interleaved) · `8.5` partition/retention verify · `8.6` docs/runbook.
- **Demo:** check-in quét CCCD → OCR tự điền; xuất báo cáo lưu trú; khách thực thi quyền dữ liệu; **go-live checklist xanh** (backup drill OK, alert chạy, load đạt budget, security zero high/critical).

---

## Đường găng (critical path)

`S1 (RLS+isolation)` → `S2 (resource/occupancy + pricing)` → `S3 (booking)` → `S4 (finance + realtime)` là chuỗi phụ thuộc cứng. S5–S6 song song hoá được nhiều hơn. **Track residency (⚖️) là phụ thuộc ngoài-kỹ-thuật** — trễ sẽ chặn lưu CCCD ở Sprint 6 → khởi động từ Sprint 1.

## Rủi ro lịch

- 12 tuần là **tham vọng** với đội nhỏ. Điểm hay trượt: S1 (RLS+pooling), S4 (tài chính + đối soát), S5 (quá tải — đã có phương án đẩy 4.7/6.7), S6 (compliance phụ thuộc bên thứ ba).
- Nếu phải cắt để kịp go-live: giữ S1–S4 (lõi đặt phòng + tiền) + night-audit; hoãn `4.7` billing-lite (thu phí tay), `6.7` một phần, adaptive sync; OCR/police-report đẩy ngay sau go-live **chỉ khi** residency chưa chốt.
