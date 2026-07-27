# UI/01 — WEB-ADMIN: PAGE INVENTORY (30 route)

> Mỗi page: route · mục đích · thành phần chính · API chính · quyền. Dialog/drawer thuộc page chứa nó. Trạng thái loading/empty/error/realtime bắt buộc theo [`00-ui-overview.md`](00-ui-overview.md) §2.6 + §6. Quyền ghi theo ma trận `04` §4 — bảng dưới ghi role được *vào trang*.
>
> **Bản này đã đồng bộ với code thật.** Ba chỗ triển khai gộp route so với thiết kế ban đầu — ghi rõ tại từng nhóm: nhóm **P** gộp 6 route con thành tab trong `/properties`, nhóm **R** gộp 3 route thành tab trong `/reports`, và **G2** dùng dialog thay cho route riêng. Mục nào chưa dựng được thì có cột/ghi chú **Trạng thái** nêu rõ lý do.

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
| G2 | *(dialog trong `/guests`, không phải route riêng)* | Hồ sơ: thông tin (PII mask), consent NĐ13, blacklist toggle (lý do); nút "Xem giấy tờ" (decrypt + audit READ_PII). **Chưa có lịch sử lưu trú + tổng chi tiêu** — `GET /bookings` chưa lọc được theo `guest_id`, phải mở rộng BE trước (ghi chú tại `components/guests/GuestDetailDialog.tsx`) | `GET /guests/:id`, `GET /guests/:id/id-document` | như G1 |

## Nhóm F — Finance (4 page)

| ID | Route | Mục đích & thành phần | API | Roles |
|----|-------|------------------------|-----|-------|
| F1 | `/invoices` | List + filter (status, kind, property, kỳ); badge OVERDUE đỏ; tổng theo filter | `GET /invoices` | OWNER, MANAGER, ACCOUNTANT, STAFF(read) |
| F2 | `/invoices/[id]` | Chi tiết: items (DEPOSIT_APPLIED âm hiện rõ "Cấn cọc"), paid/balance, payments list. *Chưa có xuất PDF* — `modules/invoices` chưa có endpoint render PDF nào. **Dialogs:** Record payment (method, amount mặc định = balance) · **VietQrPanel** (QR + realtime tick xanh khi `payment.received`) · Refund (ConfirmDanger + reason) · Void (giữ số — ConfirmDanger) | `GET /invoices/:id`, `POST /payments`, `POST /payments/:id/refund`, `POST /invoices/:id/void` | như F1 (void/refund theo quyền) |
| F3 | `/payments` | Sổ thu: list payment + filter (method, status, người nhận, ngày); export CSV | `GET /payments` | OWNER, ACCOUNTANT, MANAGER |
| F4 | `/payments/unmatched` | **Đối soát:** bảng biến động chưa khớp (nội dung CK gốc, số tiền, thời gian); hành động Match → chọn invoice/payment · Ignore (lý do). Realtime khi webhook về. *Chưa có panel gợi ý match* — điểm tin cậy nằm trong worker `payments/reconciliation.service.ts`, chưa lộ ra API | `GET /payments/unmatched`, `POST /payments/unmatched/:id/resolve\|ignore` | OWNER, ACCOUNTANT (`payment.reconcile`) |

## Nhóm P — Properties & Pricing (1 route, 5 tab)

**Triển khai gộp:** tất cả nằm trong route `/properties`, chuyển bằng tab; cơ sở đang thao tác lấy từ `PropertySwitcher` ở TopBar chứ không từ `[id]` trên URL. Lý do: mọi tab đều thao tác trên đúng một cơ sở đang chọn, nên `[id]` lặp lại thông tin đã có ở thanh trên. Nút **"Thêm cơ sở"** nằm ở `PageHeader`, hiện **cả khi chưa chọn cơ sở nào** — nếu không, tenant vừa đăng ký không có đường tạo cơ sở đầu tiên.

| ID | Tab trong `/properties` | Mục đích & thành phần | API | Roles |
|----|-------|------------------------|-----|-------|
| P1 | *(nút "Thêm cơ sở" ở header)* | Dialog tạo cơ sở; 422 `PLAN_LIMIT_REACHED` → hộp thoại mời nâng gói + link `/settings/billing`. **Không** hiện nguyên văn `detail` của BE (chuỗi đó viết cho lập trình viên) | `POST /properties` | OWNER |
| P2 | Thông tin cơ sở | Bảng thuộc tính + dialog sửa: địa chỉ (tỉnh/thành bắt buộc — báo cáo công an), múi giờ, cấu hình thuê lại cho thuê, `police_business_code`. Hai mô hình trả chủ nhà (tiền thuê cố định / chia % doanh thu) **loại trừ nhau** — UI cho chọn một, chỉ gửi field tương ứng | `GET/PATCH /properties/:id` | OWNER, MANAGER |
| P3 | Phòng | Bảng phòng + tạo phòng + đổi trạng thái buồng phòng. *Chưa có:* sửa/xoá/khôi phục phòng, `buffer_minutes`, ảnh & tiện nghi | `GET/POST /rooms`, `PATCH /rooms/:id/housekeeping` | OWNER, MANAGER |
| P4 | Bookable unit | List resource (ROOM tự sinh) + tạo **WHOLE** chọn phòng thành viên. *Chưa có:* sửa resource, preview "đặt nguyên căn sẽ chặn N phòng" | `GET/POST /bookable-resources` | OWNER, MANAGER |
| P6+P7 | Gói giá | List gói theo phương thức (badge mặc định, cọc, số đơn vị áp dụng). **Dialogs:** tạo/sửa gói (nhóm field theo mode; `mode` khoá khi sửa vì `UpdateRatePlanRequestSchema` không nhận) · luật giá (mùa/thứ/lễ, độ ưu tiên) · gán đơn vị bán (PUT thay thế toàn bộ) · **Thử giá** gọi đúng `POST /pricing/quote` của luồng đặt phòng | `GET/POST/PATCH/DELETE /rate-plans`, `PUT /rate-plans/:id/resources`, `/rate-plans/:id/rules`, `POST /pricing/quote` | OWNER, MANAGER |
| P5 | Block bảo trì | room_blocks: chọn phòng → list + tạo + xoá; 409 nếu trùng booking | `GET/POST/DELETE /room-blocks` | OWNER, MANAGER |

> **Đơn vị phần trăm:** mọi giá trị % trong hệ thống lưu **basis point** (10000 = 100%) — `rate_plans.deposit_value`, `rate_plan_rules.price_modifier_value`, `discount_codes.discount_value`, `properties.landlord_revenue_share_bp`. Người dùng luôn nhập/đọc theo %; quy đổi tập trung ở `apps/web-admin/src/lib/rate-plan-format.ts`, KHÔNG rải `/100` trong component.

## Nhóm R — Reports (1 route, 5 tab)

**Triển khai gộp:** R1–R3 là tab trong route `/reports` (không tách 3 route), cộng 2 tab ngoài thiết kế ban đầu.

| ID | Tab trong `/reports` | Mục đích | API | Roles |
|----|-------|----------|-----|-------|
| R1 | Lãi lỗ | P&L theo property + khoảng tháng: bảng cấu trúc `09` §8 + chart revenue/cost/profit; chú thích "doanh thu ghi nhận khi check-out" | `GET /reports/pnl` | OWNER, MANAGER, ACCOUNTANT |
| R2 | Điểm hoà vốn | 3 kịch bản (cards) + đường occupancy hiện tại so với điểm hoà vốn | `GET /reports/break-even` | như R1 |
| R3 | Công suất | Heatmap occupancy theo ngày × property; ADR/RevPAR trend | `GET /reports/occupancy` | OWNER, MANAGER, ACCOUNTANT, STAFF (operational) |
| R4 | Bảng kê chủ nhà | Kỳ kê cho chủ nhà gốc mô hình thuê lại cho thuê (doanh thu, chi phí, tiền thuê, chia %) | `GET /reports/landlord-statement` | OWNER, ACCOUNTANT |
| R5 | Chống thất thoát | Dấu hiệu bất thường: huỷ sau thu tiền mặt, hoàn tiền bất thường theo nhân viên, sửa giá sau nhận phòng | `GET /reports/anti-fraud` | OWNER, ACCOUNTANT |

## Nhóm CH — Channels (2 page)

| ID | Route | Mục đích | API | Roles |
|----|-------|----------|-----|-------|
| CH1 | `/channels` | List kênh per property; mapping resource ↔ listing (external id, pull URL); **push URL + token** (copy, regenerate — ConfirmDanger); trạng thái sync gần nhất, nút "Sync now" | `GET/POST /channels`, `/channel-mappings`, `POST /sync/trigger` | OWNER, MANAGER |
| CH2 | `/channels/sync-logs` | **CHƯA DỰNG.** Bảng sync_jobs + drill sync_logs; **conflict center:** danh sách overbooking_detected chưa xử lý → link booking. Chặn ở BE: mới có `GET /channels/:id/sync-jobs` và `GET /channels/conflict-count` (chỉ đếm), **chưa có endpoint liệt kê xung đột chi tiết và chưa có `/sync-logs` cấp cao**. Hiện `/channels` chỉ hiện badge đếm xung đột | *(cần bổ sung BE)* | OWNER, MANAGER |

## Nhóm CL — Cleaning (1 page)

| ID | Route | Mục đích | API | Roles |
|----|-------|----------|-----|-------|
| CL1 | `/cleaning` | Kanban PENDING / IN_PROGRESS / COMPLETED / VERIFIED; card: phòng, loại, người được gán, due, ảnh; drag để assign/verify (quyền); filter property/người | `GET/PATCH /cleaning-tasks` | OWNER, MANAGER, STAFF |

## Nhóm N — Notifications (1 page)

| ID | Route | Mục đích | API |
|----|-------|----------|-----|
| N1 | `/notifications` | Trung tâm thông báo in-app (badge đếm trên TopBar realtime); lọc chưa đọc; đánh dấu đã đọc. Vào từ link "Xem tất cả" trong popover chuông — **không** có mục sidebar riêng. Chỉ render title/body/thời gian, KHÔNG hiện `metadata` (có thể chứa PII khách).<br>**Giới hạn:** BE chỉ nhận `unread_only` + `limit` ≤100, không có phân trang con trỏ → trang lấy trọn 100 dòng gần nhất và nói rõ khi chạm mốc | `GET /notifications`, **`POST`** `/notifications/:id/read` (không phải PATCH) |

## Nhóm S — Settings (6 page)

| ID | Route | Mục đích & thành phần | API | Roles |
|----|-------|------------------------|-----|-------|
| S1 | `/settings` | Hồ sơ tenant: tên, slug (read-only), múi giờ, tiền tệ. *Chưa có logo, locale mặc định, chính sách (hạn cọc PENDING, giờ no-show)* — `UpdateTenantRequestSchema` ở BE chưa có các field này | `GET/PATCH /tenant` | OWNER |
| S2 | `/settings/users` | List user + role; **mời user** (email, default role); per-property roles editor (gán property × role, override grant/deny); deactivate | `GET/POST /users`, `/user-property-roles` | OWNER |
| S3 | `/settings/billing` | Gói hiện tại + usage bars (rooms/users/properties so với max_*); lịch sử thanh toán SaaS; nâng gói → **VietQrPanel** thanh toán; trạng thái TRIAL đếm ngược / SUSPENDED banner toàn app | `GET /billing`, `POST /billing/upgrade` | OWNER |
| S4 | `/settings/security` | Đổi password; bật/tắt 2FA (QR TOTP + backup codes — bắt buộc OWNER/ACCOUNTANT); sessions list + revoke | `/auth/2fa/*`, `/auth/sessions` | mọi user (tự mình) |
| S5 | `/settings/audit-logs` | Bảng audit (filter entity/action/user/ngày); diff viewer before/after (đã redact); export | `GET /audit-logs` | OWNER, ACCOUNTANT |
| S6 | `/settings/compliance` | **Báo cáo lưu trú:** chọn property + khoảng → preview + download Excel (TT56); consents log; data-export/erasure request cho khách (có cảnh báo legal-hold) | `GET /compliance/police-report`, `POST /guests/:id/data-*` | OWNER, MANAGER |

## Nhóm W — Trang thêm ngoài thiết kế ban đầu (Đợt 2, 6 route)

Sáu route dựng trong Đợt 2 nhưng chưa có trong bản inventory gốc.

| Route | Mục đích | API | Roles |
|-------|----------|-----|-------|
| `/assets` | Tài sản cố định + lịch khấu hao + thanh lý | `GET/POST/PATCH/DELETE /assets` | OWNER, ACCOUNTANT |
| `/expenses` | Chi phí vận hành 14 loại + chi phí định kỳ; hoa hồng OTA chỉ đọc (auto sinh khi trả phòng) | `GET/POST/PATCH/DELETE /expenses` | OWNER, MANAGER, ACCOUNTANT |
| `/discounts` | Mã giảm giá / voucher (FIXED / PERCENT basis-point, phạm vi theo cơ sở, hạn dùng) | `GET/POST/PATCH/DELETE /discount-codes` | OWNER, MANAGER |
| `/shifts` | Sổ quỹ ca thu ngân: mở/đóng ca, đếm tiền, lệch so với thu tiền mặt trong ca | `GET/POST /shifts`, `POST /shifts/:id/close` | OWNER, ACCOUNTANT, STAFF |
| `/reports` | Route chứa 5 tab báo cáo — xem nhóm R | — | như nhóm R |
| `/settings/compliance/foreign-residence` | NA17 khai báo tạm trú khách nước ngoài + tải mẫu xlsx | `/compliance/foreign-residence*` | OWNER, MANAGER |

> **Platform admin console** (quản lý tenants/plans cho chính chúng ta): MVP dùng API + scripts nội bộ (`platform_users` auth riêng) — chưa build UI. Phase 2: console riêng tối giản.
