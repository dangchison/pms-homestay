-- Up Migration
-- ============================================================================
-- 0029 — % chia doanh thu chủ nhà gốc (R2R) cho Landlord statement (Phase 3 #14)
-- Thêm landlord_revenue_share_bp để mô hình hoá hợp đồng rent-to-rent CHIA % DOANH
-- THU (basis points: 10000 = 100%). NULL = dùng mô hình thuê CỐ ĐỊNH sẵn có
-- (monthly_landlord_rent_vnd). Báo cáo kỳ cho chủ nhà gốc (GET /reports/landlord-
-- statement) chọn mô hình thanh toán theo cột nào được set. Nullable, forward-only,
-- backward-compatible. properties đã RLS — thêm cột thường, không đổi policy.
-- ============================================================================

ALTER TABLE properties
  ADD COLUMN landlord_revenue_share_bp INT
    CHECK (landlord_revenue_share_bp IS NULL OR landlord_revenue_share_bp BETWEEN 0 AND 10000);

COMMENT ON COLUMN properties.landlord_revenue_share_bp IS
  'R2R: % chia doanh thu cho chủ nhà gốc theo basis points (10000=100%). NULL = dùng monthly_landlord_rent_vnd (thuê cố định). docs/16 #14.';
