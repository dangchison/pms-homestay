# UI/01 — WEB-ADMIN: PAGE INVENTORY (35 page)

> Mỗi page: route · mục đích · thành phần chính · API chính · quyền. Dialog/drawer thuộc page chứa nó. Trạng thái loading/empty/error/realtime bắt buộc theo [`00-ui-overview.md`](00-ui-overview.md) §2.6 + §6. Quyền ghi theo ma trận `04` §4 — bảng dưới ghi role được *vào trang*.

## Nhóm A — Auth (4 page, layout riêng không sidebar)

| ID | Route | Mục đích & thành phần | API |
|----|-------|------------------------|-----|
| A1 | `/login` | Email + password; bước 2 nhập TOTP nếu user bật 2FA; link forgot. Lỗi throttle (429) hiện đếm ngược | `POST /auth/login`, `POST /auth/2fa/verify` |
| A2 | `/register` | Form tạo tenant: tên hiển thị, email, password, loại hình KD; tạo xong → onboarding checklist trên Dashboard | `POST /auth/register` |
| A3 | `/forgot-password` | Nhập email → thông báo trung tính (không lộ email tồn tại) | `POST /auth/forgot-password` |
| A4 | `/reset-password?token=` | Đặt password mới (đo độ mạnh, min 10) | `POST /auth/reset-password` |

## Nhóm D — Dashboard (1 page)

| ID | Route | Mục đích & thành phần | API | Roles |
|----|-------|------------------------|-----|-------|
| D1 | `/` | **Hôm nay của cả tenant:** 4 stat cards (đến/đi hôm nay, đang ở, doanh thu hôm nay — ACCOUNTANT/OWNER mới thấy tiền); danh sách arrivals & departures (click → booking); cảnh báo: conflict OTA, unmatched payments, invoice OVERDUE, phòng DIRTY quá lâu; onboarding checklist cho tenant mới (tạo property → phòng → rate plan → booking đầu). SSE update | `GET /dashboard/summary`, `GET /bookings?arrival=today…` | Tất cả (ẩn phần tiền theo quyền) |

## Nhóm C — Calendar (1 page — MÀN HÌNH LÕI)

| ID | Route | Roles |
|----|-------|-------|
| C1 | `/calendar` | OWNER, MANAGER, STAFF |

**Bố cục (wireframe):**

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Property ▾] [Tuần|Tháng|Ngày-giờ] [◀ 10–23/06 ▶] [Hôm nay] [+ Đặt] │
├──────────────┬───────────────────────────────────────────────────────┤
│ Resource     │ T2 10 │ T3 11 │ T4 12 │ T5 13 │ T6 14 │ T7 15 │ CN 16 │
├──────────────┼───────┴───────┴───────┴───────┴───────┴───────┴───────┤
│ ▾ Villa A    │                                                       │
│  Nguyên căn  │        ░░░░░░ BLOCK bảo trì ░░░░░░                    │
│  P.101  ●CL  │ ▓▓▓ Nguyễn Văn A (CONF) ▓▓▓ │      │ ▒OTA▒ Airbnb    │
│  P.102  ●DT  │      │ ▓ HOLD 09:41 ▓ │            │                  │
│ ▾ Nhà B      │                                                       │
│  P.201  ●CL  │ ▓▓▓▓▓▓▓ Trần B (CHECKED_IN) ▓▓▓▓▓▓▓▓▓▓▓▓             │
└──────────────┴───────────────────────────────────────────────────────┘
 ● dot housekeeping (CL=clean, DT=dirty…)   màu block theo token ui/00 §3
```

- **Dữ liệu:** `GET /occupancy?property_id&from&to` (occupancy rows + booking/block tóm tắt) — calendar đọc occupancy, không tự suy từ bookings.
- **Tương tác:** kéo chọn khoảng trống → popover "Đặt nhanh" (→ B2 prefill) · click block → drawer booking tóm tắt (→ B3) · **kéo-thả block sang resource khác** = switch (`POST /bookings/:id/switch-resource`, If-Match; 409 → revert + toast) · kéo mép = đổi ngày (PATCH; 409 OVERLAP → revert + dialog conflict) · click ô housekeeping dot → đổi trạng thái buồng phòng (quyền `room.housekeeping.change`).
- **Chế độ ngày-giờ** (cho HOURLY): trục X = giờ trong 1 ngày, hiện booking theo giờ + buffer mờ hai đầu.
- **Realtime:** SSE `booking.*`, `room.housekeeping_changed`, `room.blocked` → invalidate range đang xem.
- WHOLE booking hiển thị **một block phủ các phòng thành viên** (visual span) + badge "Nguyên căn".

## Nhóm B — Bookings (3 page)

| ID | Route | Mục đích & thành phần | API | Roles |
|----|-------|------------------------|-----|-------|
| B1 | `/bookings` | List + filter (property, status, nguồn, khoảng ngày, q=mã/tên khách); cursor pagination; row: code, khách, resource, in/out, status badge, tổng tiền, nguồn (icon OTA); bulk không có (an toàn) | `GET /bookings` | OWNER, MANAGER, STAFF, ACCOUNTANT(read) |
| B2 | `/bookings/new` | **Form tạo + quote sống** (flow chi tiết: `03-key-flows` F1): ResourcePicker → DateTimeRange → mode → GuestPicker → QuoteBreakdown (auto gọi quote khi đổi input, debounce 400ms) → hiện cọc phải trả → Submit (Idempotency-Key). Hỗ trợ walk-in nhanh (F2: bỏ qua quote chi tiết, mode mặc định) | `POST /pricing/quote`, `POST /bookings` | OWNER, MANAGER, STAFF |
| B3 | `/bookings/[id]` | Chi tiết: timeline trạng thái (booking_status_history), thông tin khách (PII ẩn — số giấy tờ hiện `****1234`, nút "Xem" quyền `guest.pii.read` + audit), invoices liên quan (kind badge), occupancy/phòng, nguồn OTA + external_uid. **Dialogs:** Check-in (→ flow F3) · Check-out (→ F4) · Cancel (reason bắt buộc; cảnh báo chính sách cọc) · Switch resource (chọn resource trống cùng khoảng — availability check trước) · Sửa ngày giờ (If-Match) | `GET /bookings/:id`, `POST /:id/check-in|check-out|cancel|switch-resource` | như B1 |

## Nhóm G — Guests (2 page)

| ID | Route | Mục đích | API | Roles |
|----|-------|----------|-----|-------|
| G1 | `/guests` | List + search (tên trgm / SĐT / **4 số cuối giấy tờ**); badge blacklist | `GET /guests?q=` | OWNER, MANAGER, STAFF |
| G2 | `/guests/[id]` | Hồ sơ: thông tin (PII mask), lịch sử lưu trú, tổng chi tiêu, consent NĐ13, blacklist toggle (lý do); nút "Xem giấy tờ" (decrypt + audit READ_PII, pre-signed ảnh 15') | `GET /guests/:id`, `GET /guests/:id/document` | như G1 |

## Nhóm F — Finance (4 page)

| ID | Route | Mục đích & thành phần | API | Roles |
|----|-------|------------------------|-----|-------|
| F1 | `/invoices` | List + filter (status, kind, property, kỳ); badge OVERDUE đỏ; tổng theo filter | `GET /invoices` | OWNER, MANAGER, ACCOUNTANT, STAFF(read) |
| F2 | `/invoices/[id]` | Chi tiết: items (DEPOSIT_APPLIED âm hiện rõ "Cấn cọc"), paid/balance, payments list, PDF. **Dialogs:** Record payment (method, amount mặc định = balance) · **VietQrPanel** (QR + realtime tick xanh khi `payment.received`) · Refund (ConfirmDanger + reason) · Void (giữ số — ConfirmDanger) | `GET /invoices/:id`, `POST /payments`, `POST /payments/:id/refund`, `POST /invoices/:id/void` | như F1 (void/refund theo quyền) |
| F3 | `/payments` | Sổ thu: list payment + filter (method, status, người nhận, ngày); export CSV | `GET /payments` | OWNER, ACCOUNTANT, MANAGER |
| F4 | `/payments/unmatched` | **Đối soát:** bảng biến động chưa khớp (nội dung CK gốc, số tiền, thời gian); panel phải gợi ý match (confidence + lý do); hành động Match → chọn invoice/payment · Ignore (lý do). Realtime khi webhook về | `GET /payments/unmatched`, `POST /payments/unmatched/:id/resolve\|ignore` | OWNER, ACCOUNTANT (`payment.reconcile`) |

## Nhóm P — Properties & Pricing (7 page)

| ID | Route | Mục đích & thành phần | API | Roles |
|----|-------|------------------------|-----|-------|
| P1 | `/properties` | Cards property (ảnh, số phòng, occupancy nay); nút tạo (check plan limit → 422 dialog nâng gói) | `GET/POST /properties` | OWNER, MANAGER(read) |
| P2 | `/properties/[id]` | Tab "Thông tin": địa chỉ (province bắt buộc — báo cáo công an), TZ, R2R config (landlord, hợp đồng, tiền thuê), police_business_code | `GET/PATCH /properties/:id` | OWNER, MANAGER |
| P3 | `/properties/[id]/rooms` | Bảng phòng: số, sức chứa, buffer_minutes, housekeeping dot, active; drawer tạo/sửa room (ảnh, tiện nghi); soft-delete + restore | `GET/POST/PATCH/DELETE /rooms` | OWNER, MANAGER |
| P4 | `/properties/[id]/resources` | **Cấu hình đơn vị bán:** list resource (ROOM auto, badge); tạo/sửa **WHOLE** — chọn phòng thành viên (checkbox), preview "đặt nguyên căn sẽ chặn N phòng"; cảnh báo khi phòng thuộc nhiều WHOLE | `GET/POST/PATCH /resources` | OWNER, MANAGER |
| P5 | `/properties/[id]/blocks` | room_blocks: list + tạo (phòng, khoảng, lý do); 409 nếu trùng booking — hiện conflict | `GET/POST/DELETE /room-blocks` | OWNER, MANAGER |
| P6 | `/properties/[id]/rate-plans` | List plan theo mode (badge default); gán resources; deposit policy hiển thị | `GET/POST /rate-plans` | OWNER, MANAGER |
| P7 | `/properties/[id]/rate-plans/[planId]` | **Editor:** giá cơ bản + config theo mode (HOURLY: gói/block/đêm; DAILY: giờ in/out, phí sớm/trễ; MONTHLY: điện nước — cảnh báo giá EVN `12` §7) + bảng rules (mùa/thứ/lễ, priority — validate chồng priority ngay trên UI) + **Tester:** nhập khoảng ở thử → QuoteBreakdown xem giá tính ra | `GET/PATCH /rate-plans/:id`, `POST /pricing/quote` | OWNER, MANAGER |

## Nhóm R — Reports (3 page)

| ID | Route | Mục đích | API | Roles |
|----|-------|----------|-----|-------|
| R1 | `/reports/pnl` | P&L theo property + khoảng tháng: bảng cấu trúc `09` §8 + chart revenue/cost/profit; export PDF/Excel; chú thích "doanh thu ghi nhận khi check-out" | `GET /reports/pnl` | OWNER, MANAGER, ACCOUNTANT |
| R2 | `/reports/break-even` | 3 kịch bản (cards) + đường occupancy hiện tại so với điểm hoà vốn; input chỉnh F_fixed giả định | `GET /reports/break-even` | như R1 |
| R3 | `/reports/occupancy` | Heatmap occupancy theo ngày × property; ADR/RevPAR trend | `GET /reports/occupancy` | OWNER, MANAGER, ACCOUNTANT, STAFF (operational) |

## Nhóm CH — Channels (2 page)

| ID | Route | Mục đích | API | Roles |
|----|-------|----------|-----|-------|
| CH1 | `/channels` | List kênh per property; mapping resource ↔ listing (external id, pull URL); **push URL + token** (copy, regenerate — ConfirmDanger); trạng thái sync gần nhất, nút "Sync now" | `GET/POST /channels`, `/channel-mappings`, `POST /sync/trigger` | OWNER, MANAGER |
| CH2 | `/channels/sync-logs` | Bảng sync_jobs (status, counts, conflicts) + drill sync_logs; **conflict center:** danh sách overbooking_detected chưa xử lý → link booking liên quan | `GET /sync-jobs`, `GET /sync-logs` | OWNER, MANAGER |

## Nhóm CL — Cleaning (1 page)

| ID | Route | Mục đích | API | Roles |
|----|-------|----------|-----|-------|
| CL1 | `/cleaning` | Kanban PENDING / IN_PROGRESS / COMPLETED / VERIFIED; card: phòng, loại, người được gán, due, ảnh; drag để assign/verify (quyền); filter property/người | `GET/PATCH /cleaning-tasks` | OWNER, MANAGER, STAFF |

## Nhóm N — Notifications (1 page)

| ID | Route | Mục đích | API |
|----|-------|----------|-----|
| N1 | `/notifications` | Trung tâm thông báo in-app (badge đếm trên TopBar realtime); mark read; click → deep-link entity | `GET/PATCH /notifications` |

## Nhóm S — Settings (6 page)

| ID | Route | Mục đích & thành phần | API | Roles |
|----|-------|------------------------|-----|-------|
| S1 | `/settings` | Hồ sơ tenant: tên, slug (read-only), logo, TZ/locale mặc định, chính sách (hạn cọc PENDING, giờ no-show) | `GET/PATCH /tenant` | OWNER |
| S2 | `/settings/users` | List user + role; **mời user** (email, default role); per-property roles editor (gán property × role, override grant/deny); deactivate | `GET/POST /users`, `/user-property-roles` | OWNER |
| S3 | `/settings/billing` | Gói hiện tại + usage bars (rooms/users/properties so với max_*); lịch sử thanh toán SaaS; nâng gói → **VietQrPanel** thanh toán; trạng thái TRIAL đếm ngược / SUSPENDED banner toàn app | `GET /billing`, `POST /billing/upgrade` | OWNER |
| S4 | `/settings/security` | Đổi password; bật/tắt 2FA (QR TOTP + backup codes — bắt buộc OWNER/ACCOUNTANT); sessions list + revoke | `/auth/2fa/*`, `/auth/sessions` | mọi user (tự mình) |
| S5 | `/settings/audit-logs` | Bảng audit (filter entity/action/user/ngày); diff viewer before/after (đã redact); export | `GET /audit-logs` | OWNER, ACCOUNTANT |
| S6 | `/settings/compliance` | **Báo cáo lưu trú:** chọn property + khoảng → preview + download Excel (TT56); consents log; data-export/erasure request cho khách (có cảnh báo legal-hold) | `GET /compliance/police-report`, `POST /guests/:id/data-*` | OWNER, MANAGER |

> **Platform admin console** (quản lý tenants/plans cho chính chúng ta): MVP dùng API + scripts nội bộ (`platform_users` auth riêng) — chưa build UI. Phase 2: console riêng tối giản.
