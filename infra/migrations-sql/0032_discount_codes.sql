-- Up Migration
-- ============================================================================
-- 0032 — Mã giảm giá / khuyến mãi (discount_codes) — Wave-1 #4, docs/07 §7
-- Bảng GLOBAL-theo-tenant (mỗi tenant tự quản mã của mình) cho voucher áp vào
-- BÁO GIÁ (quote) khi tạo booking: giảm tiền cố định (FIXED, đơn vị VND) hoặc
-- giảm theo phần trăm (PERCENT, basis-point 0..10000 — 10000 = 100%, cùng quy
-- ước với properties.landlord_revenue_share_bp ở 0029 và rate_plan_rules PERCENT).
--
-- Task này CHỈ dựng hạ tầng dữ liệu: bảng + ràng buộc miền + RLS. Logic áp mã
-- (tính giảm vào quote, tăng used_count atomic, chống double-spend, kiểm
-- applicable_property_ids thuộc tenant) thuộc task áp-dụng-voucher sau (9.4b) ở
-- tầng service — KHÔNG đặt ở migration. Vì vậy KHÔNG có CHECK (used_count<=max_uses)
-- (cần cập nhật đồng thời khó, để service lo); ở đây chỉ đảm bảo miền dữ liệu
-- (>=0, NULL=vô hạn).
--
-- discount_value ĐA NGHĨA theo discount_type → CHECK phân nhánh (xem bên dưới):
--   FIXED   → discount_value > 0 (số tiền VND)
--   PERCENT → discount_value BETWEEN 0 AND 10000 (basis-point)
-- Ràng buộc này đồng bộ y hệt ở refine của shared-types (discount-code.ts) để
-- FE/BE fail sớm trước khi chạm DB.
--
-- Native ENUM discount_type: FIXED|PERCENT là tập ĐÓNG, ổn định → dùng native
-- ENUM (docs/03 §13, giống payment_status/invoice_status). ALTER TYPE ADD VALUE
-- khó tiến hoá/không revert — chấp nhận vì loại giảm giá không hay đổi; nếu tương
-- lai cần loại thứ 3 dạng hay đổi thì cân nhắc VARCHAR+CHECK ở migration SAU,
-- KHÔNG sửa 0032.
--
-- RLS tenant-scoped (CRUD qua withTenant). Composite FK chuẩn chung: UNIQUE
-- (tenant_id, id) làm target cho các bảng con tương lai (vd booking_discounts)
-- tham chiếu (tenant_id, discount_code_id) — ADR-0005. Soft-delete (deleted_at)
-- + partial unique (tenant_id, code) WHERE deleted_at IS NULL (docs/03 §4.4).
--
-- Retention: 'Không xoá' (finance-like) — voucher gắn với báo giá/booking, giữ
-- để audit; KHÔNG night-audit xoá (docs/03 §7). KHÔNG chứa PII, KHÔNG credentials.
-- Forward-only + additive: chỉ CREATE, không ALTER/DROP bảng/enum/policy cũ.
-- ============================================================================

CREATE TYPE discount_type AS ENUM ('FIXED', 'PERCENT');

CREATE TABLE discount_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  code CITEXT NOT NULL,                          -- mã voucher, so khớp KHÔNG phân biệt hoa/thường (citext)
  discount_type discount_type NOT NULL,          -- FIXED (VND) | PERCENT (basis-point)
  discount_value BIGINT NOT NULL,                -- FIXED: số tiền VND; PERCENT: bp 0..10000 (xem CHECK)
  min_order_vnd BIGINT NOT NULL DEFAULT 0,       -- giá trị đơn tối thiểu để áp mã (VND)
  max_uses INT,                                  -- số lượt tối đa; NULL = không giới hạn
  used_count INT NOT NULL DEFAULT 0,             -- lượt đã dùng (service tăng atomic ở task áp mã)
  valid_from TIMESTAMPTZ,                         -- hiệu lực từ; NULL = không giới hạn đầu
  valid_to TIMESTAMPTZ,                           -- hiệu lực đến; NULL = không giới hạn cuối
  applicable_property_ids UUID[],                -- danh sách cơ sở áp dụng; NULL = MỌI cơ sở (KHÁC mảng rỗng)
  is_active BOOLEAN NOT NULL DEFAULT true,        -- bật/tắt nhanh không cần soft-delete
  deleted_at TIMESTAMPTZ,                          -- soft-delete (docs/03 §4.4)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- discount_value đúng theo semantic 2 loại (đồng bộ refine shared-types)
  CONSTRAINT discount_codes_value_by_type CHECK (
    (discount_type = 'FIXED'   AND discount_value > 0) OR
    (discount_type = 'PERCENT' AND discount_value BETWEEN 0 AND 10000)
  ),
  -- ràng buộc miền dữ liệu bổ trợ
  CONSTRAINT discount_codes_min_order_nonneg CHECK (min_order_vnd >= 0),
  CONSTRAINT discount_codes_used_count_nonneg CHECK (used_count >= 0),
  CONSTRAINT discount_codes_max_uses_nonneg CHECK (max_uses IS NULL OR max_uses >= 0),
  CONSTRAINT discount_codes_valid_window CHECK (
    valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to
  ),

  UNIQUE (tenant_id, id)                          -- target composite FK chuẩn chung (ADR-0005)
);

COMMENT ON COLUMN discount_codes.discount_value IS
  'FIXED: số tiền giảm (VND, >0). PERCENT: basis-point 0..10000 (10000=100%). Semantic theo discount_type (CHECK discount_codes_value_by_type).';
COMMENT ON COLUMN discount_codes.applicable_property_ids IS
  'Danh sách property áp dụng. NULL = áp cho MỌI property (KHÁC mảng rỗng []). KHÔNG FK cấp phần tử array (Postgres không hỗ trợ); tính hợp lệ property thuộc tenant do service kiểm ở task áp mã.';
COMMENT ON COLUMN discount_codes.max_uses IS
  'Số lượt dùng tối đa. NULL = không giới hạn. Ràng buộc used_count<=max_uses do service kiểm (atomic), KHÔNG ở DB.';

-- UNIQUE code theo tenant CHỈ khi chưa soft-delete (cho phép tái tạo mã sau khi
-- xoá mềm — docs/03 §4.4). code là CITEXT → 'SUMMER' và 'summer' bị coi trùng.
-- Cột dẫn đầu là tenant_id → đồng thời thoả yêu cầu "index tenant_id đứng đầu"
-- cho RLS/scan hiệu quả.
CREATE UNIQUE INDEX uq_discount_codes_tenant_code_live
  ON discount_codes (tenant_id, code)
  WHERE deleted_at IS NULL;

CREATE TRIGGER discount_codes_set_updated_at
  BEFORE UPDATE ON discount_codes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enforce_tenant_isolation('discount_codes');
