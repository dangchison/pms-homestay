# UI/03 — KEY FLOWS (8 luồng nghiệp vụ xuyên màn hình)

> Mỗi flow: actor → các bước (màn hình ↔ API ↔ lỗi & UX). Mã màn hình theo [`01`](01-web-admin-pages.md)/[`02`](02-web-staff-pages.md). Quy ước xử lý lỗi chung: [`00`](00-ui-overview.md) §6.

## F1 — Tạo booking (DAILY, có cọc 30%)

**Actor:** lễ tân/manager (web-admin). **Kết quả:** booking CONFIRMED sau khi khách chuyển cọc.

| # | Màn hình | Hành động | API | Lỗi có thể & UX |
|---|----------|-----------|-----|------------------|
| 1 | C1 Calendar | Kéo chọn khoảng trống trên resource → popover "Đặt nhanh" → "Tạo chi tiết" | `GET /occupancy` (đã có) | — |
| 2 | B2 Form | Resource + ngày giờ prefill; chọn khách (GuestPicker — search/tạo mới); mode DAILY | `GET /guests?q=` | — |
| 3 | B2 Form | QuoteBreakdown tự gọi khi đủ input (debounce 400ms): hiện từng đêm (giá lễ/cuối tuần), tổng, **"Cọc cần thu: 30% = 1.050.000 ₫"** | `POST /pricing/quote` | 422 validation → highlight field |
| 4 | B2 Form | Bấm "Tạo & giữ chỗ" (Idempotency-Key) | `POST /bookings {quote_id}` | `409 BOOKING_OVERLAP` → dialog conflict + "Xem trên calendar" · `409 PRICE_CHANGED` → panel giá mới → re-quote → retry |
| 5 | B3 Detail | Booking `PENDING` (expires 24h hiện đếm ngược); DEPOSIT invoice tự tạo; mở **VietQrPanel** cho khách quét | (invoice đã sinh server-side) | — |
| 6 | B3 / F2 | Khách chuyển khoản → webhook Casso match → payment SUCCEEDED → **booking tự CONFIRMED**; UI tick xanh realtime (SSE `payment.received`, `booking.confirmed`) | webhook (server) | Không khớp tự động → nằm ở F4-unmatched (`01` F4), lễ tân match tay |
| ALT | — | Khách không chuyển trong 24h → night-audit hủy `DEPOSIT_TIMEOUT`, slot tự nhả, notification | — | — |

## F2 — Walk-in nhanh (khách đứng tại quầy)

| # | Màn hình | Hành động | API | Lỗi & UX |
|---|----------|-----------|-----|----------|
| 1 | C1 | Popover "Đặt nhanh": resource + khoảng + "Walk-in" | — | — |
| 2 | Popover | Nhập tên + SĐT (guest tạo nhanh), quote rút gọn hiện tổng | `POST /pricing/quote` | — |
| 3 | Popover | "Tạo & check-in luôn" → booking `source=WALK_IN` CONFIRMED (bỏ HOLD/cọc — thu tiền tại quầy) → chuyển B3 mở sẵn dialog check-in (→ F3 từ bước 2, thường bỏ scan nếu khách vội — nhập tay tối thiểu cho báo cáo lưu trú) | `POST /bookings`, `POST /:id/check-in` | OVERLAP như F1 |

## F3 — Check-in với scan CCCD (staff PWA)

**Precondition:** booking CONFIRMED hôm nay; cọc đã đủ (nếu thiếu → T2 hiện badge chặn, thu thêm trước).

| # | Màn hình | Hành động | API | Lỗi & UX |
|---|----------|-----------|-----|----------|
| 1 | T2 Today | Chạm card khách đến → "Check-in" | — | — |
| 2 | T3 ① | Chụp 2 mặt CCCD → upload pre-signed (storage VN) → gọi OCR | `POST /guests/scan-id` | OCR fail/timeout 15s → toast + nút "Nhập tay" (luôn hiện) |
| 3 | T3 ② | Form prefill; field confidence thấp viền vàng; lễ tân sửa; tick consent NĐ13 | `PATCH /guests/:id` (số giấy tờ → enc/hash/last4 server-side) | validation → inline |
| 4 | T3 ③ | Thu nốt tiền nếu balance > 0 (QR/cash) → "Check-in" | `POST /payments?`, `POST /bookings/:id/check-in` | `422 BOOKING_INVALID_STATUS` (đã check-in máy khác) → reload |
| 5 | T2 | Card chuyển "Đang ở"; phòng vào danh sách báo cáo lưu trú của ngày (S6) | SSE `booking.checked_in` | — |

## F4 — Check-out + phụ thu + tất toán

| # | Màn hình | Hành động | API | Lỗi & UX |
|---|----------|-----------|-----|----------|
| 1 | T2/B3 | "Check-out" → màn folio T4 | `GET /bookings/:id/folio` | — |
| 2 | T4 | STAY invoice draft: tiền phòng (snapshot quote) + **"Cấn cọc −1.050.000 ₫"**; thêm phụ thu (minibar 35k…) | `POST /invoices/:id/items` | invoice đã ISSUED → 422 (chỉ thêm khi DRAFT — UI khoá sau khi issue) |
| 3 | T4 | "Phát hành & thu" → invoice ISSUED, balance hiện to; thu cash hoặc QR (tick realtime) | `POST /invoices/:id/issue`, `POST /payments` | số tiền lệch → server tính lại, client hiển thị từ response (không tự cộng) |
| 4 | T4 | Balance = 0 → nút "Check-out" sáng → xác nhận | `POST /bookings/:id/check-out` | MANAGER được override ghi nợ (balance>0) — confirm + lý do |
| 5 | hệ thống | Occupancy nhả + cleaning task tự sinh (HOUSEKEEPER nhận noti) + commission OTA auto-expense + doanh thu ghi nhận | SSE `booking.checked_out`, `cleaning_task.assigned` | — |

## F5 — Xử lý conflict OTA (overbooking detected)

| # | Màn hình | Hành động | API | Ghi chú |
|---|----------|-----------|-----|---------|
| 1 | (nền) | iCal pull gặp event đụng booking nội bộ → constraint chặn → log + event | — | hệ thống KHÔNG tự hủy bên nào (`08` §3) |
| 2 | D1 + N1 | OWNER/MANAGER nhận cảnh báo đỏ "Overbooking Airbnb ↔ BK-…" | SSE `booking.overbooking_detected` | — |
| 3 | CH2 Conflict center | Xem 2 phía: event OTA (uid, khoảng) vs booking nội bộ; hành động gợi ý: (a) đổi resource cho booking nội bộ (→ switch dialog, availability check) (b) hủy booking nội bộ (c) chặn lịch trên OTA rồi đánh dấu đã xử lý | `POST /bookings/:id/switch-resource` / `cancel` | lần pull sau event OTA vào được → conflict tự đóng |

## F6 — Refund (hoàn một phần)

| # | Màn hình | Hành động | API | Lỗi & UX |
|---|----------|-----------|-----|----------|
| 1 | F2 Invoice | "Refund" trên payment SUCCEEDED → ConfirmDangerDialog: số tiền (≤ phần chưa hoàn), lý do bắt buộc | — | quyền `payment.refund` (OWNER/ACCOUNTANT) |
| 2 | F2 | Xác nhận → payment `PARTIALLY_REFUNDED`; **paid/balance cập nhật đúng** (trigger ADR-0003); badge invoice đổi | `POST /payments/:id/refund` | refund > còn lại → 422 |
| 3 | F2 | Hoàn tiền thực tế: chuyển khoản tay (MVP) — ghi chú số tham chiếu; audit log | — | — |

## F7 — Khách thuê tháng: chỉ số điện nước → hoá đơn tháng

| # | Màn hình | Hành động | API | Ghi chú |
|---|----------|-----------|-----|---------|
| 1 | T7/T5 (PWA) | Cuối tháng: staff vào phòng ghi chỉ số (form điện kWh, nước m³ — hiện chỉ số kỳ trước để đối chiếu) | `POST /monthly-meter-readings` | chụp ảnh đồng hồ đính kèm (optional) |
| 2 | (nền) | Đêm 1: night-audit sinh `MONTHLY_RENT` invoice (tiền nhà pro-rate + điện nước × đơn giá — default EVN) | job (server) | thiếu chỉ số → invoice DRAFT + noti nhắc |
| 3 | F2 | OWNER/khách nhận invoice; thu qua VietQR như thường | — | ZNS gửi link/QR cho khách (4.4) |

## F8 — Xuất báo cáo lưu trú công an

| # | Màn hình | Hành động | API | Ghi chú |
|---|----------|-----------|-----|---------|
| 1 | S6 Compliance | Chọn property + ngày/khoảng → "Tạo báo cáo" | `GET /compliance/police-report` | — |
| 2 | S6 | Preview bảng khách (đã check-in trong kỳ): họ tên, DOB, giấy tờ (decrypt batch — 1 audit READ_PII), quốc tịch, giờ vào/ra | — | khách quốc tế đánh dấu (hạn 12h — nhắc trên D1) |
| 3 | S6 | Download Excel (template TT56) → OWNER tự upload cổng dichvucong | — | Phase 2: nút "Gửi" API trực tiếp |

---

## Phụ lục — bản đồ event SSE → màn hình cần invalidate

| Event | Màn hình tự cập nhật |
|-------|----------------------|
| `booking.*` | C1, B1, B3, D1, T2 |
| `payment.received/refunded` | F1–F4, B3 (VietQrPanel tick), S3 |
| `invoice.*` | F1, F2, D1 |
| `cleaning_task.*` | CL1, T5, T6, D1 |
| `room.housekeeping_changed` | C1 (dot), T7, CL1 |
| `booking.overbooking_detected` | D1, N1, CH2 |
| `sync_job.*` | CH1, CH2 |
