-- Up Migration
-- ============================================================================
-- 0012 — Đối soát thanh toán Casso/SePay (task 3.4)
-- DDL docs/03 §4.6, docs/09 §5. webhook_events_received: dedup CROSS-TENANT (PK
-- source+event_id) — webhook public chạy TRƯỚC khi resolve tenant nên KHÔNG RLS.
-- unmatched_payments: biến động số dư chưa khớp → host đối soát tay (RLS).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- webhook_events_received — dedup webhook (KHÔNG RLS: insert lúc chưa có tenant)
-- ----------------------------------------------------------------------------
CREATE TABLE webhook_events_received (
  source VARCHAR(32) NOT NULL,                   -- CASSO, SEPAY, CHANNEX,...
  event_id VARCHAR(255) NOT NULL,
  tenant_id UUID,                                -- set sau khi resolve (nullable)
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  PRIMARY KEY (source, event_id)
);

-- ----------------------------------------------------------------------------
-- unmatched_payments — giao dịch không tự khớp (đối soát tay)
-- ----------------------------------------------------------------------------
CREATE TABLE unmatched_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  provider VARCHAR(50) NOT NULL,                 -- CASSO, SEPAY, MANUAL
  transaction_ref VARCHAR(255) NOT NULL,
  amount_vnd BIGINT NOT NULL,
  content TEXT,                                  -- nội dung chuyển khoản gốc
  bank_account VARCHAR(64),
  received_at TIMESTAMPTZ,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING'  -- PENDING | RESOLVED | IGNORED
    CHECK (status IN ('PENDING', 'RESOLVED', 'IGNORED')),
  resolved_payment_id UUID,
  resolved_by UUID,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, transaction_ref)
);
CREATE INDEX idx_unmatched_payments_pending ON unmatched_payments (tenant_id, status)
  WHERE status = 'PENDING';

SELECT enforce_tenant_isolation('unmatched_payments');
