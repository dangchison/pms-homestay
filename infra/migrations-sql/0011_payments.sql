-- Up Migration
-- ============================================================================
-- 0011 — Payments + payment_attempts + VietQR bank config (task 3.3)
-- DDL docs/03 §4.6, ADR-0003 §1. payments là nguồn sự thật "đã thu":
--   • trigger duy trì invoices.paid_vnd theo CÔNG THỨC refund-aware (ADR-0003 §1):
--     SUCCEEDED + PARTIALLY_REFUNDED, trừ refunded_amount; balance_vnd generated.
--   • trigger tự chuyển invoice ISSUED → PARTIALLY_PAID/PAID (về REFUNDED khi hoàn
--     hết). THAY seam markDepositPaid của 3.2.
-- Thêm bank nhận tiền vào properties cho VietQR động (12 §5) — nguồn merchant_account.
-- ============================================================================

CREATE TYPE payment_status AS ENUM (
  'PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'
);

-- ----------------------------------------------------------------------------
-- payments
-- ----------------------------------------------------------------------------
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  invoice_id UUID NOT NULL,
  amount_vnd BIGINT NOT NULL CHECK (amount_vnd > 0),
  method VARCHAR(32) NOT NULL CHECK (method IN
    ('CASH','VIETQR','BANK_TRANSFER','MOMO','ZALOPAY','CARD','OTA_COLLECTED','OTHER')),
  status payment_status NOT NULL DEFAULT 'PENDING',
  reference_code VARCHAR(255),                   -- mã giao dịch bên thanh toán
  provider VARCHAR(50),                          -- VCB, MB, CASSO, SEPAY,...
  provider_metadata JSONB,
  received_by UUID,
  received_at TIMESTAMPTZ,
  refunded_amount_vnd BIGINT NOT NULL DEFAULT 0 CHECK (refunded_amount_vnd >= 0),
  refunded_at TIMESTAMPTZ,
  refund_reason TEXT,
  idempotency_key VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (refunded_amount_vnd <= amount_vnd),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id)
);
-- partial unique BẮT BUỘC là index riêng (UNIQUE...WHERE inline không hợp lệ SQL)
CREATE UNIQUE INDEX uq_payments_idem ON payments (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_payments_invoice ON payments (invoice_id);

CREATE TRIGGER payments_set_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enforce_tenant_isolation('payments');

-- ----------------------------------------------------------------------------
-- payment_attempts (lịch sử thử/đối soát mỗi payment)
-- ----------------------------------------------------------------------------
CREATE TABLE payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  payment_id UUID NOT NULL,
  attempt_number INT NOT NULL,
  status payment_status NOT NULL,
  raw_response JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments (tenant_id, id)
);
CREATE INDEX idx_payment_attempts_payment ON payment_attempts (payment_id);

SELECT enforce_tenant_isolation('payment_attempts');

-- ----------------------------------------------------------------------------
-- Trigger: invoices.paid_vnd + auto-status từ payments (ADR-0003 §1)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recompute_invoice_paid() RETURNS trigger AS $$
DECLARE
  inv UUID := COALESCE(NEW.invoice_id, OLD.invoice_id);
  v_paid BIGINT;
  v_total BIGINT;
  v_has_refund BOOLEAN;
BEGIN
  SELECT
    COALESCE(SUM(amount_vnd)          FILTER (WHERE status IN ('SUCCEEDED','PARTIALLY_REFUNDED')), 0)
  - COALESCE(SUM(refunded_amount_vnd) FILTER (WHERE status IN ('SUCCEEDED','PARTIALLY_REFUNDED')), 0),
    bool_or(status IN ('REFUNDED','PARTIALLY_REFUNDED'))
  INTO v_paid, v_has_refund
  FROM payments WHERE invoice_id = inv;

  SELECT total_vnd INTO v_total FROM invoices WHERE id = inv;

  UPDATE invoices SET
    paid_vnd = v_paid,
    status = CASE
      WHEN status IN ('VOID', 'DRAFT') THEN status
      WHEN v_paid >= v_total AND v_total > 0 THEN 'PAID'::invoice_status
      WHEN v_paid > 0 THEN 'PARTIALLY_PAID'::invoice_status
      WHEN COALESCE(v_has_refund, false) THEN 'REFUNDED'::invoice_status
      WHEN status IN ('PAID', 'PARTIALLY_PAID') THEN 'ISSUED'::invoice_status
      ELSE status
    END,
    paid_at = CASE WHEN v_paid >= v_total AND v_total > 0 THEN COALESCE(paid_at, now()) ELSE NULL END
  WHERE id = inv;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_recompute_invoice
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION recompute_invoice_paid();

-- ----------------------------------------------------------------------------
-- properties: tài khoản nhận tiền (VietQR động — docs/12 §5)
-- ----------------------------------------------------------------------------
ALTER TABLE properties
  ADD COLUMN bank_bin VARCHAR(8),                -- NAPAS BIN: 970422 (MB), 970436 (VCB)
  ADD COLUMN bank_account_number VARCHAR(32),
  ADD COLUMN bank_account_name VARCHAR(255);
