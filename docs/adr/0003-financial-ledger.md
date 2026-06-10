# ADR-0003 — Tầng tài chính: sửa công thức paid + tiến tới immutable ledger

- **Status:** Accepted
- **Ngày:** 2026-06-09
- **Liên quan:** review §E3, §A5

## Context

- Công thức `invoices.paid_vnd = Σ(payments WHERE status='SUCCEEDED')` **sai khi có refund**: nếu payment chuyển `PARTIALLY_REFUNDED` thì bị loại khỏi tổng (mất nguyên khoản); nếu giữ `SUCCEEDED` + `refunded_amount` thì tổng thừa phần đã hoàn. Đã kiểm chứng trên PostgreSQL 16.
- Hai nguồn sự thật tiền: `bookings.{total,paid,deposit,commission}_vnd` vs `invoices.{total,paid,balance}_vnd` → drift.
- Đặt cọc (deposit) đang bị coi như đã thu, không phân biệt **nợ phải trả (liability)** vs **doanh thu ghi nhận**.

## Decision

### Phần bắt buộc cho MVP

1. **Công thức paid đúng** (đã chứng minh):
   ```sql
   paid_vnd = COALESCE(SUM(amount_vnd)  FILTER (WHERE status IN ('SUCCEEDED','PARTIALLY_REFUNDED')), 0)
            - COALESCE(SUM(refunded_vnd) FILTER (WHERE status IN ('SUCCEEDED','PARTIALLY_REFUNDED')), 0);
   ```
2. **`balance_vnd` là generated column** `GENERATED ALWAYS AS (total_vnd - paid_vnd) STORED` — bỏ DEFAULT gây hiểu nhầm. (Vì `paid_vnd` được trigger duy trì từ bảng `payments`, `balance` generated từ 2 cột cùng hàng là hợp lệ.)
3. **Một nguồn sự thật:** invoice/payment là sự thật tài chính. `bookings.total_amount_vnd` chỉ là **snapshot "giá đã chốt"** read-only tại thời điểm tạo; mọi tính nợ/đã trả/hoàn lấy từ invoice+payment. Bỏ `paid_amount_vnd`/`deposit_amount_vnd` trùng trên bookings (hoặc đánh dấu derived, không ghi).
4. **Rounding tập trung:** một hàm làm tròn duy nhất (round-half-up) dùng chung `pricing-engine` + finance; tiền luôn `BIGINT` VND.

### Mục tiêu kiến trúc (giai đoạn 2 — thiết kế bảng từ đầu)

5. **Immutable ledger** `ledger_entries` (append-only): mỗi sự kiện tiền (issue invoice, payment, refund, áp cọc) sinh bút toán kép vào các account: `CASH`, `AR` (phải thu), `DEPOSIT_LIABILITY` (cọc — nợ phải trả tới khi áp vào invoice), `REVENUE` (ghi nhận khi `CHECKED_OUT`). Số dư **derive** bằng SUM theo account, không trigger-aggregate. Đối soát = invariant `Σdebit = Σcredit`.

## Consequences

**Tích cực:** số tiền đúng kể cả refund; kiểm toán được; cọc ≠ doanh thu (đúng kế toán); hết drift booking↔invoice.

**Tiêu cực:** ledger thêm phức tạp (nên defer phần 5 sang phase 2, nhưng tạo bảng + viết bút toán cho payment/refund sớm để không phải backfill); generated column cần migration raw SQL (xem ADR-0001).

## Alternatives considered

- **Giữ trigger-aggregate đơn giản** — *Bác bỏ dài hạn:* sai refund, khó audit, khó đối soát.
- **Event sourcing toàn phần** — *Bác bỏ:* overkill cho MVP; ledger append-only đã đủ tính bất biến/audit.

---

## Amendment 2026-06-10 — Cơ chế cọc & hoá đơn nhiều kỳ (đóng 2 lỗ hổng MVP)

Audit lần 2 phát hiện 2 lỗ hổng mô hình mà phần Decision chưa đóng:

1. **Vòng lặp deposit:** confirm booking cần "deposit paid" → `payments.invoice_id NOT NULL` → invoice chỉ ISSUED khi CONFIRMED ⇒ cọc phải trả vào invoice DRAFT (mâu thuẫn "DRAFT chưa có hiệu lực").
2. **Booking↔Invoice 1:1 vỡ với MONTHLY:** khách thuê 6 tháng cần hoá đơn **mỗi tháng** (tiền nhà + điện nước); 1 hoá đơn duy nhất không phản ánh được.

**Quyết định bổ sung (bắt buộc cho MVP):**

- `invoices.kind` ENUM: `DEPOSIT | STAY | MONTHLY_RENT | ADJUSTMENT`. Quan hệ booking↔invoice là **1:N**.
- **Luồng cọc:** tại `PENDING`, hệ thống issue ngay một **DEPOSIT invoice** (số tiền theo chính sách cọc của rate plan / nhập tay). Payment SUCCEEDED trên DEPOSIT invoice → booking tự chuyển `CONFIRMED`. Về kế toán, tiền cọc là **liability** (chưa phải doanh thu).
- **Khi check-out:** issue **STAY invoice** (tiền phòng + phụ thu) kèm line item `DEPOSIT_APPLIED` (giá trị âm, tham chiếu DEPOSIT invoice) để cấn trừ. Hủy booking: refund cọc theo chính sách, hoặc forfeit (DEPOSIT invoice giữ PAID, ghi nhận như doanh thu hủy qua `ADJUSTMENT`).
- **MONTHLY:** job billing-cycle hằng tháng sinh `MONTHLY_RENT` invoice cho mỗi booking MONTHLY đang active (tiền nhà pro-rate /30 + điện nước từ `monthly_meter_readings` kỳ trước). Booking MONTHLY khi check-out chỉ còn quyết toán kỳ cuối.
- **Hoa hồng OTA — một đường ghi duy nhất:** `bookings.commission_vnd` chỉ là input snapshot; khi booking `CHECKED_OUT`, hệ thống **tự sinh** `operational_expenses(type=OTA_COMMISSION, source_booking_id=...)`. P&L chỉ đọc từ expenses ⇒ không double-count.
