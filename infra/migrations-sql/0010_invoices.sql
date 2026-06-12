-- Up Migration
-- ============================================================================
-- 0010 — Invoices + invoice_items (task 3.2)
-- DDL theo docs/03 §4.6, ADR-0003 (+ amendment cọc/nhiều kỳ). Booking↔invoice 1:N
-- qua `kind` (DEPOSIT|STAY|MONTHLY_RENT|ADJUSTMENT). Bất biến tài chính (docs/09 §2):
--   • total_vnd = SUM(invoice_items.amount_vnd)  → trigger duy trì
--   • balance_vnd = total_vnd − paid_vnd         → generated column
--   • paid_vnd duy trì từ `payments` (trigger ở task 3.3); nay default 0, seam
--     markDepositPaid (service) tạm set khi cọc thanh toán để demo luồng confirm.
--   • items chỉ sửa khi DRAFT (enforce ở service); ISSUED sai → VOID giữ số + ADJUSTMENT.
--
-- void_reason/voided_* KHÔNG có trong ERD gốc — thêm tối thiểu để lưu lý do VOID
-- (audit_logs đầy đủ nối ở task 4.5).
-- ============================================================================

CREATE TYPE invoice_kind AS ENUM ('DEPOSIT', 'STAY', 'MONTHLY_RENT', 'ADJUSTMENT');
CREATE TYPE invoice_status AS ENUM (
  'DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID', 'REFUNDED'
);

-- ----------------------------------------------------------------------------
-- invoices
-- ----------------------------------------------------------------------------
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  booking_id UUID,                               -- NULL = invoice ad-hoc
  kind invoice_kind NOT NULL DEFAULT 'STAY',
  invoice_number VARCHAR(30) NOT NULL,           -- INV-202606-0001 (document_counters)
  status invoice_status NOT NULL DEFAULT 'DRAFT',
  billing_period VARCHAR(7),                     -- '2026-06' cho MONTHLY_RENT
  subtotal_vnd BIGINT NOT NULL DEFAULT 0,
  discount_vnd BIGINT NOT NULL DEFAULT 0,
  tax_vnd BIGINT NOT NULL DEFAULT 0,
  total_vnd BIGINT NOT NULL DEFAULT 0,           -- = SUM(invoice_items.amount_vnd), trigger
  paid_vnd BIGINT NOT NULL DEFAULT 0,            -- trigger từ payments (task 3.3); công thức §2.3
  balance_vnd BIGINT GENERATED ALWAYS AS (total_vnd - paid_vnd) STORED,
  due_date DATE,
  issued_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  void_reason TEXT,                              -- lý do VOID (giữ số)
  voided_at TIMESTAMPTZ,
  voided_by UUID,
  pdf_url TEXT,
  version INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, invoice_number),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, booking_id) REFERENCES bookings (tenant_id, id)
);
CREATE INDEX idx_invoices_booking ON invoices (booking_id);
CREATE INDEX idx_invoices_overdue ON invoices (tenant_id, due_date)
  WHERE status IN ('ISSUED', 'PARTIALLY_PAID');
-- idempotent MONTHLY_RENT: 1 invoice / (booking, kỳ) — task 4.5/4.6 dựa vào
CREATE UNIQUE INDEX uq_invoices_monthly_period ON invoices (booking_id, billing_period)
  WHERE kind = 'MONTHLY_RENT';

CREATE TRIGGER invoices_set_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enforce_tenant_isolation('invoices');

-- ----------------------------------------------------------------------------
-- invoice_items
-- ----------------------------------------------------------------------------
CREATE TABLE invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  invoice_id UUID NOT NULL,
  item_type VARCHAR(32) NOT NULL,                -- ROOM_CHARGE, SURCHARGE, DISCOUNT, TAX, UTILITY,
                                                 -- AMENITY, DEPOSIT_APPLIED (amount ÂM, cấn cọc)
  description VARCHAR(500) NOT NULL,
  quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
  unit_price_vnd BIGINT NOT NULL,
  amount_vnd BIGINT NOT NULL,                    -- = quantity × unit_price (DEPOSIT_APPLIED âm)
  ref_invoice_id UUID,                           -- DEPOSIT_APPLIED trỏ về DEPOSIT invoice
  display_order INT NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_invoice_items_invoice ON invoice_items (invoice_id);

SELECT enforce_tenant_isolation('invoice_items');

-- ----------------------------------------------------------------------------
-- Trigger: invoices.total_vnd = SUM(items) (docs/09 §2.2). subtotal/discount/tax
-- derive theo loại; total = SUM mọi dòng (DEPOSIT_APPLIED âm tự cấn). balance_vnd
-- generated tự cập nhật. RLS đã set GUC tenant trong tx gọi → chỉ thấy đúng tenant.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recompute_invoice_totals() RETURNS trigger AS $$
DECLARE
  inv UUID := COALESCE(NEW.invoice_id, OLD.invoice_id);
BEGIN
  UPDATE invoices SET
    subtotal_vnd = COALESCE((SELECT SUM(amount_vnd) FROM invoice_items
                             WHERE invoice_id = inv AND item_type NOT IN ('TAX', 'DISCOUNT')), 0),
    tax_vnd      = COALESCE((SELECT SUM(amount_vnd) FROM invoice_items
                             WHERE invoice_id = inv AND item_type = 'TAX'), 0),
    discount_vnd = COALESCE(-(SELECT SUM(amount_vnd) FROM invoice_items
                             WHERE invoice_id = inv AND item_type = 'DISCOUNT'), 0),
    total_vnd    = COALESCE((SELECT SUM(amount_vnd) FROM invoice_items
                             WHERE invoice_id = inv), 0)
  WHERE id = inv;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_items_recompute
  AFTER INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION recompute_invoice_totals();
