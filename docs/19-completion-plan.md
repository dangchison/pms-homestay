# 19 — KẾ HOẠCH HOÀN THIỆN CHỨC NĂNG (demo-first)

> **Ngày:** 2026-07-02. Mục tiêu: **toàn bộ chức năng hệ thống hoạt động được** khi truy cập bằng demo account. Khảo sát bằng 13 agent (quét web-admin/web-staff/API/seed/docs + kiểm chứng độc lập từng kết luận) + xác minh trực tiếp.
>
> Quyết định của chủ dự án: (1) tích hợp thiếu credentials → làm **mock/sandbox adapter** chạy end-to-end ngay, thay provider thật sau chỉ bằng env; (2) thứ tự: **lấp gap demo nhìn thấy trước** (web-admin), sau đó theo wave giá trị kinh doanh (docs/16).
>
> Quy ước: 1 task = 1 PR (theo docs/00 §7 — khi thực thi tạo task vào [`14-roadmap-tasks.md`](14-roadmap-tasks.md)). File này là bản kế hoạch tổng; không code thẳng từ đây.

## Vị trí trong tiến trình tổng — KHÔNG reset tiến độ

File này chia việc còn lại thành **7 ĐỢT** (batch). Cố ý dùng chữ "Đợt" để KHÔNG nhầm với "Phase" của dự án — tiến trình Phase vẫn nguyên:

| Tiến trình dự án | Trạng thái |
|---|---|
| **Phase 1 — MVP** (EPIC 1–8, 50 task, docs/14) | ✅ XONG — không đụng lại |
| **Phase 2 — Backlog hoàn thiện** (docs/18) | ✅ XONG phần tự-code — chỉ còn C2/C3/C4 + creds → gom vào **Đợt 7** |
| **Phase 3 — Product roadmap** (docs/16) | 🟡 ĐANG CHẠY — Wave-1 BE xong 6 hạng mục (#57–#61); **docs/19 = phần còn lại của Phase 3 + lớp UI/seed/mock để demo dùng được** |

Chính vì Phase 1–2 đã xong nên phần lớn task dưới đây chỉ là **lớp UI/seed mỏng nối vào backend sẵn có**.

## 0. Chẩn đoán

Cảm giác "rất nhiều phần chưa triển khai" KHÔNG phải do backend thiếu — BE đã có 31 module đầy đủ (MVP 50/50 + Phase 2 + 6 tính năng Wave-1 PR #57–#61). Nguyên nhân thực:

1. **6 trang web-admin còn là PlaceholderPage** dù BE sẵn sàng 100%: `/bookings` (list), `/bookings/[id]`, `/guests`, `/cleaning`, `/properties`, `/channels`.
2. **12 tính năng BE-có-UI-không**: discounts, sổ quỹ ca, landlord statement, anti-fraud, NA17, expenses, assets, meter readings, notifications inbox (chuông TopBar là stub), platform-summary chip, nút submit B6, booking surcharges.
3. **10 bảng không có seed demo** → trang trống dù có UI: discount_codes, channels+mappings, cash_shifts, operational_expenses, assets, subscription_payments, unmatched_payments, foreign_residence_declarations, monthly_meter_readings, booking_surcharges.
4. **Tích hợp ngoài stub/chặn creds**: SMS/ZNS (B2), gateway billing (B4), XNC/police (stub có chủ đích — đạt chuẩn), e-invoice + Channex (chưa có), OCR FPT.AI (thiếu key), ops C2/C3/C4.
5. **3 tính năng Wave-1 chưa code**: #1 Hosted booking page, #5 ZNS guest messaging, #24 OCR bill.

Phát hiện kỹ thuật ảnh hưởng thiết kế (đã đọc code): `BookingResponse` không có `guest_name`/`resource_name`; `GET /invoices?booking_id=` có sẵn; quote flow ĐÃ hỗ trợ `discount_code`; STAFF chưa có `payment.reconcile` (docs/14 follow-up 9.4 yêu cầu PR riêng); anti-fraud đọc `booking_status_history` mà seed chưa insert; seed idempotent kiểu RESET-theo-tenant.

## 1. Tổng quan 7 đợt

| Đợt | Nội dung | Số PR | Effort |
|---|---|:--:|---|
| **1** | Web-admin core pages — 6 trang placeholder | 6 | ~3–4 tuần-người |
| **2** | Wave-1 UI + tiện ích — 12 UI + ca thu ngân web-staff | 10 | ~3 tuần-người |
| **3** | Seed demo mở rộng — 10 bảng (chạy SONG SONG ngay sau task đầu Đợt 1) | 1 | 2–3 ngày |
| **4** | Mock/sandbox providers (M1–M4) | 4 | ~1 sprint |
| **5** | Wave-1 còn lại: #5 ZNS (W5a–c), #24 OCR bill (W24a–b), #1 Hosted page (ADR + W1a–d) | 9+1 ADR | ~2 sprint |
| **6** | Wave-2 backlog (thứ tự khuyến nghị — chi tiết hoá khi tới) | — | — |
| **7** | Ops cần creds thật (chờ chủ dự án cung cấp) | — | — |

Nguyên tắc: provider ngoài đi qua **driver interface + DI factory theo env** (mock là implementation ngang hàng, không if/else rải rác); endpoint public theo pattern `IcalPublicController` (`@Public` + `@SkipTenantScope` + SQL function SECURITY DEFINER + rate-limit Redis).

---

## 2. ĐỢT 1 — Web-admin core pages (6 PR)

Mỗi page dùng PageContainer + PageHeader; components @pms/ui; hooks TanStack Query tại `lib/hooks/use-*.ts`; SSE invalidate qua `use-events.ts`; e2e Playwright theo mẫu `apps/web-admin/e2e` (loginDemo).

### 1.1 `/bookings` — danh sách + filter (M)
- `useBookingsList` (mẫu useInvoices; queryKey `['bookings','list',...]` — SSE `booking.*` invalidate sẵn).
- Filter status/DateRange + bảng (code, phòng, ngày, BookingStatusBadge, nguồn, tổng) + phân trang `page_info`; row → `/bookings/[id]`.
- Tên phòng: client-join `useResources`. Tên khách: **enrich BE tối thiểu** — thêm `guest_name`/`resource_name` optional vào `BookingResponseSchema` + LEFT JOIN (pattern sẵn bookings.service.ts:426-452, backward-compatible).
- Filter "nguồn": client-side (BE không hỗ trợ — chú thích).
- e2e: ≥17 booking seed, filter CHECKED_IN đúng.

### 1.2 `/bookings/[id]` — chi tiết + lifecycle (L)
- Hooks: `useBooking`, `useBookingActions` (confirm/cancel/check-in/check-out), `useUpdateBooking` (If-Match → 428/409), `useInvoicesByBooking`.
- Card thông tin (status, ngày kế hoạch/thực tế, nguồn, mode, `police_report_status`) + card khách (mask PII) + card hoá đơn + khối thao tác theo máy trạng thái + dialog lý do huỷ.
- Đổi phòng/reschedule tái dùng logic `use-calendar.ts:37,86`. Timeline từ mốc sẵn có (KHÔNG bịa endpoint status-history).
- Là đích nút "Mở chi tiết" của `BookingDetailDialog.tsx:78`.

### 1.3 `/properties` — phòng/resource/block (L)
- 3 tab: Phòng (CRUD + housekeeping) · Bookable unit (ROOM/WHOLE + members) · Block bảo trì.
- Hooks mới: `use-rooms.ts`, mở rộng `use-resources.ts`, `use-room-blocks.ts`.
- Thông tin cơ sở (bank, R2R/landlord fields) để ở /settings — tránh trùng.
- e2e: tạo phòng → hiện calendar; tạo block → hiện occupancy.

### 1.4 `/guests` — hồ sơ khách + blacklist (M)
- `useGuestsList(q, page)`; search debounce; bảng + badge blacklist; GuestDetailSheet: "Xem giấy tờ đầy đủ" (audit READ_PII), blacklist/unblacklist + lý do; nhúng hooks NĐ13 từ `use-compliance.ts`.
- BE không có filter booking theo guest_id — ghi hạn chế, không bịa.

### 1.5 `/cleaning` — board điều phối (M)
- Port ~80% hooks từ web-staff `use-cleaning.ts`; UI desktop Kanban 4 cột PENDING/IN_PROGRESS/COMPLETED/VERIFIED.
- Thêm `useAssignCleaning` (Select user từ `use-users.ts`), `useVerifyCleaning`. SSE key `['cleaning']` map sẵn.

### 1.6 `/channels` — kênh iCal + mappings + sync (M)
- `use-channels.ts` đầy đủ + `useTriggerSync` + `useRegenerateToken`.
- List kênh (badge last_sync_status, toggle active); mappings (pull URL, **push URL công khai copy-button**); "Đồng bộ ngay"; 10 sync-jobs gần nhất; badge conflict từ `useConflictCount`.

## 3. ĐỢT 2 — Wave-1 UI + tiện ích (10 PR)

| # | PR | Effort | Ghi chú chính |
|---|---|:--:|---|
| 2.1 | Notifications inbox | S | Popover từ chuông TopBar (đang toast stub); useNotifications + useMarkRead + map SSE `notification.*` (kiểm tra event_type BE phát) |
| 2.2 | Discount codes: trang `/discounts` + ô mã trong BookingForm | M | Quote đã nhận `discount_code`; 422 DISCOUNT_NOT_APPLICABLE hiện dưới ô; ⚠️ xác nhận đơn vị PERCENT (bp/%) trong discounts.service trước |
| 2.3 | Sổ quỹ ca web-admin `/shifts` | M | Open (Idempotency-Key) / Close (If-Match); variance đỏ nếu âm; detail kèm payments CASH trong ca |
| 2.4 | Reports tabs: Landlord statement + Anti-fraud | M | Gộp 1 PR (cùng chạm /reports); ẩn tab landlord nếu property không `is_rent_to_rent` |
| 2.5 | `/expenses` | M | 14 loại + recurring; invalidate `['reports']` sau mutation |
| 2.6 | `/assets` | M | Bảng + drawer lịch khấu hao + dispose |
| 2.7 | Booking detail: surcharges + meter readings | S | Depends 1.2; card điện nước CHỈ khi mode MONTHLY |
| 2.8 | Compliance: NA17 + nút submit B6 | M | Trang con `/settings/compliance/foreign-residence` (form + Submit + tải NA17 xlsx); nút "Gửi B6" cạnh tải Excel TT56 |
| 2.9 | Guest platform-summary chip | S | "Khách quen (N nơi)" / đỏ "Blacklist nơi khác" trong GuestPicker + detail |
| 2.10a | **PR BE riêng**: thêm `payment.reconcile` vào STAFF | S | Theo docs/14 follow-up 9.4 + cập nhật ma trận docs/04; trade-off: STAFF thấy unmatched (ghi rõ trong PR) |
| 2.10b | web-staff: mở/đóng ca thu ngân | M | Depends 2.10a; card trong profile; STAFF không GET /shifts được (thiếu report.financial) → giữ shift_id ở store cục bộ + xử lý 409; HOUSEKEEPER ẩn |

Sidebar: thêm "Sổ quỹ ca" + "Chi phí" + "Tài sản" vào nhóm Tài chính; "Mã giảm giá" vào nhóm Cấu hình.

## 4. ĐỢT 3 — Seed demo mở rộng (1 PR, M–L) — chạy song song sớm

Giữ cơ chế RESET (DELETE theo tenant, thứ tự FK) — thêm DELETE bảng mới TRƯỚC bookings/guests: `sync_logs→sync_jobs→channel_resource_mappings→channels`; `monthly_meter_readings, booking_surcharges, foreign_residence_declarations`; `cash_shifts, unmatched_payments, subscription_payments`; `depreciation_entries→assets`; `operational_expenses`; `discount_codes` (sau quotes — quotes FK). Chèn bước 11)–20) sau bước 10 trong `seedDemoData()`; refactor `makeInvoice` trả invoiceId + `received_at` tuỳ biến.

1. **discount_codes**: SUMMER10 (PERCENT, scope NULL=mọi property) · GIAM50K (FIXED 50k, min 500k, scope [property]) · HETHAN (hết hạn → demo 422).
2. **channels**: AIRBNB_ICAL active + BOOKING_ICAL inactive; mappings `ical_pull_url=NULL` (chỉ push — cron không gọi URL giả); 3–4 sync_jobs lịch sử (1 FAILED).
3. **cash_shifts** + payments CASH khớp cửa sổ: ca CLOSED variance **−150k** (nuôi anti-fraud) · ca CLOSED variance 0 · ca OPEN sáng nay. KHÔNG insert `variance_vnd` (generated). Kèm 1 booking CANCELLED-sau-thu-CASH + insert `booking_status_history` → finding CANCEL_AFTER_CASH; 1 payment refunded (received_by letan).
4. **properties R2R**: UPDATE demo property `is_rent_to_rent=true` + landlord + thuê 25tr/tháng (trong main(), idempotent).
5. **expenses + assets + depreciation_entries**: 8 expense/60 ngày (recurring MONTHLY có parent) · 3 assets + 3–4 entries/asset.
6. **foreign_residence_declarations**: +2 guest ngoại quốc (US/KR, PASSPORT) + 2 booking không đè occupancy; 1 DRAFT + 1 SUBMITTED (XNC-DEMO-001).
7. **monthly_meter_readings**: +phòng 401 + rate plan MONTHLY + booking MONTHLY CHECKED_IN (−45d→+45d); kỳ trước đủ chỉ số, kỳ này chỉ start; 1 invoice MONTHLY_RENT.
8. **booking_surcharges**: 3 dòng gắn booking CHECKED_IN.
9. **unmatched_payments**: 2 PENDING + 1 IGNORED.
10. **subscription_payments**: 2 CONFIRMED + 1 PENDING (`payment_ref` tất định PMSSUB-DEMO-YYYYMM).
11. **notifications**: 5 in-app cho owner (2 unread).

Acceptance: `pnpm db:seed:dev` chạy 2 lần liên tiếp không lỗi; mọi trang Đợt 1–2 có dữ liệu.

## 5. ĐỢT 4 — Mock/sandbox providers (4 PR)

### M1 — `NotificationChannelProvider` + Mock ZNS/SMS + bảng `outbound_messages` (M)
`deliverTarget()` đang hardcode (SMS/ZNS = logger stub). Interface + `MockMessagingProvider` (SENT ngay, id `mock-<uuid>`) + `SmtpEmailProvider` (bọc MailService hiện có) + `NotificationProviderRegistry` (DI theo env). Migration `outbound_messages` (RLS + composite FK booking/guest nullable, retention 90 ngày, dọn trong night-audit) — nền dùng chung cho #5 ZNS. REST `GET /notifications/outbound`. Env `ZNS_PROVIDER=mock|zalo|log`, `SMS_PROVIDER=mock|esms|log` (default mock; `log`=hành vi cũ).

### M2 — Mock payment-gateway sandbox billing SaaS — đóng nốt B4 (M)
`confirmPayment()` đã idempotent → mock chỉ cần đường gọi lại: (1) delayed job BullMQ queue `billing-gateway` tự confirm sau N giây; (2) `POST /public/billing/mock-gateway/:paymentRef/pay` (@Public, 404 khi không mock, rate-limit) + nút "Thanh toán sandbox" ở settings/billing. Env `BILLING_GATEWAY=manual|mock` (default manual), `MOCK_GATEWAY_AUTOCONFIRM_SECONDS=15`. Gateway thật sau này (PayOS/VNPay) cùng interface + webhook HMAC.

### M3 — Mock OCR provider CCCD (S)
Tách `OcrProvider`: `FptOcrProvider` (giữ circuit breaker) + `MockOcrProvider` trả CCCD giả **deterministic theo SHA-256 ảnh** (cùng ảnh → cùng số → demo được person-identity 9.2). Env `OCR_PROVIDER=auto|fpt|mock` (auto default = fpt nếu có key else 503 — mock KHÔNG tự bật prod).

### M4 — Bank transfer simulator cho đối soát (S)
Script `scripts/simulate-bank-transfer.ts` (tự tính HMAC → POST webhook) + endpoint dev-only `POST /dev/simulate-bank-transfer` (**404 khi `DEMO_TOOLS_ENABLED=false`**, default false) + nút "Giả lập chuyển khoản" trên invoice detail (chỉ khi flag bật). Khép vòng demo hosted booking page: khách "CK" → invoice PAID → booking CONFIRMED.

## 6. ĐỢT 5 — Wave-1 còn lại

### #5 ZNS guest messaging (3 PR, depends M1)
Kiến trúc: BullMQ queue riêng `guest-messaging` repeatable 15' (KHÔNG dùng night-audit — mốc gửi cần đúng giờ local); idempotency = partial unique trên `outbound_messages` `(tenant, booking, trigger_type, channel)`.
- **W5a** (M): migration `guest_message_templates` (RLS + composite FK property nullable; PRE_ARRIVAL/ARRIVAL_DAY/POST_CHECKOUT; send_hour_local/offset_days/body Handlebars/enabled; unique (tenant,property,trigger)). Biến `{{guest_name}} {{wifi_name}} {{door_code}}…` — wifi/door từ `properties.metadata` JSONB. API GET/PUT `/properties/:id/message-templates` + seed 3 template tiếng Việt.
- **W5b** (M): `GuestMessagingService.runSweep(now)` — lặp tenant ACTIVE/TRIAL, query theo `properties.timezone`; render/send NGOÀI tx; e2e quét 2 lần không gửi đôi.
- **W5c** (S): UI `settings/messaging` (bật/tắt, sửa template, preview) + tab "Tin đã gửi".

### #1 Hosted booking page (1 ADR + 4 PR)
Kiến trúc chốt: **app mới `apps/web-book`** (không auth, tách cookie/CSP khỏi web-admin, deploy book.pmsapp.vn độc lập). **ADR public booking API trước W1a.**
- **W1a** (M): migration `booking_page_settings` (RLS, `slug citext` UNIQUE GLOBAL) + SQL function SECURITY DEFINER `resolve_booking_slug` (pattern resolve_ical_token). Public: `GET /public/booking/:slug` (info + resources + giá from — không PII) + `/availability`. Rate-limit 30/min/IP. Tenant API GET/PUT `/properties/:id/booking-page`.
- **W1b** (M): `POST .../quote` + `POST .../book {quote_id, guest, consent}` — find-or-create guest theo phone + consent NĐ13 → `createBookingTx` HOLD source HOSTED_PAGE → PENDING + DEPOSIT invoice → `{booking_code, qr_payload, track_token}` (JWT stateless, secret riêng, exp 72h) + `GET /public/booking/track/:token` + `/qr-image`. Chống abuse: Idempotency-Key, 5/min/IP, trần 3 HOLD active/(IP|phone)/property → 429. e2e happy-path đến CONFIRMED (kết hợp M4), concurrency 1 thắng.
- **W1c** (M): FE `apps/web-book` — `/[slug]` chọn ngày→phòng+giá; `/[slug]/book` form+consent; `/track/[token]` QR + polling 5s.
- **W1d** (S): web-admin settings/booking-page (slug, bật/tắt, copy link, QR Zalo).

### #24 OCR hoá đơn chi phí (2 PR)
- **W24a** (S–M, depends M3): `BillOcrProvider` + mock deterministic; `POST /expenses/scan-bill/presign` + `POST /expenses/scan-bill` → chỉ trả extraction (không ghi DB) → FE prefill form expenses; map expense_type theo keyword (EVN→UTILITY_ELECTRIC…). Env `BILL_OCR_PROVIDER=auto|fpt|mock`.
- **W24b** (S, depends W24a + trang 2.5): nút "Quét hoá đơn" → upload → prefill.

## 7. ĐỢT 6 — Wave-2 backlog (thứ tự khuyến nghị)

1. **#6 Pre-check-in online (M)** — tái dùng OCR mock M3 + consent + pattern token W1b.
2. **#2 Dynamic pricing rule-based (M)** — hạ tầng sẵn; feature bán hàng mạnh nhất còn lại.
3. **#3 Upsell catalog (S–M)** — invoice_items + surcharges (B5) sẵn.
4. **#12 Maintenance ticketing (M)** — khép vòng hỏng→sửa→chi phí.
5. **#15 Báo cáo thuế khoán hộ KD (S)** — rẻ nhất, rất "giữ chân VN".
6. **#19 Platform console (M)** — platform-auth + billing data sẵn.
7. **#17 e-Invoice NĐ123 mock provider (M)** — bảng e_invoices thiết kế sẵn.
8. **#16 Ledger kép (M–L)** — ADR-0003 §5; nền cho e-invoice thật.
9. **Channex full (L)** — chờ tài khoản Channex; iCal đang gánh được.
10. **#7 Smart lock (M + ADR)** — cần phần cứng thật; mock giá trị thấp → cuối.

## 8. ĐỢT 7 — Ops cần creds thật (chờ chủ dự án)

| Mục | Cần gì từ chủ dự án | Code còn lại |
|---|---|---|
| C2 Backup R2 | Cloudflare R2 bucket + keys; DB provider có PITR | Cron pg_dump 02:00 ICT → R2 + lifecycle; restore-drill RTO/RPO |
| C3 Load-test staging | Máy chủ/DB staging + secrets | Gần 0 — infra/k6 sẵn |
| C4 Object storage VN | S3-compatible region VN (VNG/FPT/Viettel) | Đổi env S3_*; kèm B3 dump audit archive → S3 |
| Sentry source-map | Secrets SENTRY_AUTH_TOKEN + SENTRY_ORG | ci.yml build per-app + SENTRY_RELEASE |
| Zalo OA/ZNS | OA verify DN + Zalo Cloud + **template ZNS duyệt** (lead-time tuần — nộp sớm); phụ: eSMS brandname | `ZaloZnsProvider` implements M1; đổi env |
| Gateway billing | PayOS/VNPay/Casso merchant + keys + webhook secret | Provider thật implements M2 + webhook HMAC |
| XNC + dịch vụ công | Tài khoản tổ chức + thoả thuận API + mã ĐVHC NSO | Thay stub submit → POST ngoài withTenant + administrative_units |
| FPT.AI OCR | API key Vision + credit (+Invoice OCR nếu #24 thật) | Set FPT_AI_API_KEY (M3 auto tự chuyển) |

## 9. Thứ tự thực thi tổng & rủi ro

```
1.1 bookings-list ──► Đợt 3 seed (song song) ──► 1.2 → 1.3 → 1.4 → 1.5 → 1.6
     └─► Đợt 2: 2.1/2.5/2.6 độc lập · 2.2 sau seed · 2.3/2.4 sau seed · 2.7 sau 1.2 · 2.8 sau seed · 2.10a → 2.10b
Đợt 4: M1 → M2 → M3 → M4 (~1 sprint)
Đợt 5: (W5a→W5b→W5c) ∥ (W24a→W24b) → ADR → W1a → W1b → (W1c ∥ W1d)
Đợt 6 chi tiết hoá khi tới · Đợt 7 khi có creds
```

**Rủi ro chính:** (1) enrich BookingResponse phải backward-compatible; (2) STAFF thấy unmatched sau 2.10a (trade-off theo docs/14); (3) web-staff không đọc được ca đang mở (state cục bộ + 409; follow-up BE "người mở đọc ca mình"); (4) đơn vị `discount_value` PERCENT (bp/%) cần xác nhận trong discounts.service trước khi seed/hiển thị; (5) thứ tự DELETE trong seed reset.

## 10. Verification (từng PR + cuối phase)

- BE e2e: `cd apps/api && LOG_LEVEL=fatal pnpm exec vitest run test/e2e/<spec>` (không `rtk vitest`, không LOG_LEVEL=silent).
- FE: `rtk tsc` + `rtk lint` + `rtk next build`; Playwright chạy trực tiếp (không rtk).
- Demo cuối mỗi đợt: `pnpm db:reset` → login `owner@demo.vn` → duyệt toàn bộ sidebar: **không còn PlaceholderPage, không còn trang trống**.
