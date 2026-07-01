-- Up Migration
-- ============================================================================
-- 0032 — Sổ quỹ ca + bàn giao ca (task 9.4, docs/16 #10 — Wave 1 chống thất thoát tiền mặt)
-- DDL docs/03 §4 (finance). cash_shifts: mỗi ca thu ngân của MỘT cơ sở — mở ca ghi
-- float đầu ca (opening_float_vnd), đóng ca đếm tiền thực (closing_counted_vnd) và
-- so với tiền mặt kỳ vọng (expected_cash_vnd = float + Σ payment CASH SUCCEEDED
-- trong ca − Σ refund CASH của các payment đó). Chênh lệch variance_vnd (đếm − kỳ
-- vọng) tính bằng GENERATED column (nguồn chân lý duy nhất — service KHÔNG ghi tay).
--
-- ★ Một ca OPEN / cơ sở tại một thời điểm: partial unique uq_cash_shift_open_per_property
--   là hàng rào chống race tạo 2 ca (service map P2002 → 409 SHIFT_ALREADY_OPEN).
--   Cửa sổ [opened_at, closed_at ?? now] không chồng nhau vì chỉ 1 ca OPEN/cơ sở.
--
-- Composite FK (tenant_id, property_id) → properties (ADR-0005) khoá liên kết trong
-- cùng tenant; UNIQUE (tenant_id, id) là đích cho các FK composite tham chiếu ca này.
-- KHÔNG PII (chỉ user_id opened_by/closed_by + số tiền) → không mã hoá field.
-- RLS (docs/02 §RLS): mọi truy cập qua withTenant; enforce_tenant_isolation áp
-- policy tenant_isolation + tenant_isolation_insert (NULLIF template).
-- Retention (docs/03 §7): Vĩnh viễn — chứng từ đối quỹ tài chính, night-audit KHÔNG xoá.
-- ============================================================================

CREATE TABLE cash_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  property_id UUID NOT NULL,
  opened_by UUID NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_float_vnd BIGINT NOT NULL DEFAULT 0 CHECK (opening_float_vnd >= 0),
  closed_by UUID,
  closed_at TIMESTAMPTZ,
  closing_counted_vnd BIGINT CHECK (closing_counted_vnd IS NULL OR closing_counted_vnd >= 0),
  expected_cash_vnd BIGINT,
  -- Chênh lệch = tiền đếm thực − tiền kỳ vọng. NULL khi ca còn OPEN (cả 2 vế NULL).
  -- GENERATED STORED → read-only với Prisma; service chỉ ghi counted + expected.
  variance_vnd BIGINT GENERATED ALWAYS AS (closing_counted_vnd - expected_cash_vnd) STORED,
  status VARCHAR(8) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  note TEXT,
  idempotency_key VARCHAR(255),                  -- POST /shifts replay-safe (Idempotency-Key header)
  version INT NOT NULL DEFAULT 1,                -- If-Match optimistic lock khi đóng ca (docs/05 §4.5)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),                         -- đích cho composite FK tham chiếu ca
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id)
);

-- ★ Tối đa 1 ca OPEN cho mỗi cơ sở (hàng rào chống race — nguồn chân lý cho SHIFT_ALREADY_OPEN).
CREATE UNIQUE INDEX uq_cash_shift_open_per_property ON cash_shifts (tenant_id, property_id)
  WHERE status = 'OPEN';

-- Replay POST /shifts theo Idempotency-Key (per-tenant) — trả đúng ca cũ, không tạo 2 row.
CREATE UNIQUE INDEX uq_cash_shift_idem ON cash_shifts (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Danh sách/lọc ca theo cơ sở (tenant-first).
CREATE INDEX idx_cash_shifts_property ON cash_shifts (tenant_id, property_id);

CREATE TRIGGER cash_shifts_set_updated_at
  BEFORE UPDATE ON cash_shifts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enforce_tenant_isolation('cash_shifts');
