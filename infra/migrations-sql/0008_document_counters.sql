-- Up Migration
-- ============================================================================
-- 0008 — Document counters (task 3.1): sinh số chứng từ atomic, không gap
-- (booking_code BK-YYYYMM-0001, invoice_number INV-YYYYMM-0001) — docs/03 §4.6.
-- UPSERT + row lock trong cùng tx với entity → rollback cùng nhau, reset theo
-- (tenant, type, period). KHÔNG dùng sequence-per-tenant.
--
-- Retention (docs/03 §7): vĩnh viễn (sổ đếm chứng từ — audit tài chính).
-- ============================================================================

CREATE TABLE document_counters (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  document_type VARCHAR(16) NOT NULL,            -- 'INV' | 'BK'
  period VARCHAR(6) NOT NULL,                     -- '202606'
  current_value INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, document_type, period)
);

SELECT enforce_tenant_isolation('document_counters');
