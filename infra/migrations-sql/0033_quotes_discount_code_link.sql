-- Up Migration
-- ============================================================================
-- 0033 — Bắc cầu voucher vào báo giá: quotes.discount_code_id → discount_codes
-- (Wave-1 #4, task 9.4b). Cột NULLABLE (mặc định NULL) trỏ tới mã giảm giá đã áp
-- cho báo giá. Booking (createBookingTx) đọc cột này để gọi redeemInTx tăng
-- used_count ATOMIC trong CÙNG tx booking — chống double-spend (docs/07 §7).
--
-- RANH GIỚI 9.4b (KHÔNG làm ở đây): task này CHỈ thêm cột liên kết + FK composite,
-- KHÔNG populate discount_code_id, KHÔNG trừ discount_vnd/total_vnd, KHÔNG đổi
-- công thức verifyQuoteForBooking (pricing.service.ts) — verify vẫn so tổng theo
-- ENGINE. Việc áp voucher vào báo giá (điền discount_code_id + tính lại tiền +
-- điều chỉnh verify so trên phần engine) thuộc task 9.4c. Vì cột mặc định NULL và
-- redeemInTx CHỈ fire khi discount_code_id != NULL nên luồng booking cũ KHÔNG đổi
-- (backward-compatible tuyệt đối).
--
-- Composite FK (tenant_id, discount_code_id) → discount_codes(tenant_id, id) theo
-- ADR-0005 (target UNIQUE(tenant_id, id) đã tạo ở 0032). ON DELETE NO ACTION: mã
-- đang được báo giá tham chiếu KHÔNG bị xoá CỨNG (mã dùng soft-delete deleted_at —
-- xoá mềm không đụng FK). ON UPDATE NO ACTION đồng bộ chuẩn chung.
--
-- Forward-only + additive: chỉ ALTER TABLE ADD COLUMN nullable + ADD CONSTRAINT
-- (không backfill, không rewrite bảng, không phá quote/booking cũ). KHÔNG PII,
-- KHÔNG credentials, KHÔNG đụng RLS (quotes đã có enforce_tenant_isolation từ 0008).
-- ============================================================================

ALTER TABLE quotes
  ADD COLUMN discount_code_id UUID;

COMMENT ON COLUMN quotes.discount_code_id IS
  'Mã giảm giá đã áp cho báo giá (NULL = không có voucher). Booking đọc cột này để redeem (tăng used_count atomic) trong tx. Điền giá trị + trừ tiền thuộc task 9.4c; 9.4b chỉ bắc cầu cột + FK.';

ALTER TABLE quotes
  ADD CONSTRAINT quotes_discount_code_fkey
  FOREIGN KEY (tenant_id, discount_code_id)
  REFERENCES discount_codes (tenant_id, id)
  ON DELETE NO ACTION ON UPDATE NO ACTION;
