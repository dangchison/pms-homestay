-- Up Migration
-- ============================================================================
-- 0007 — Guests (PII mã hoá mức field) (task 2.5)
-- DDL theo docs/03 §4.5, [ADR-0007]: số giấy tờ KHÔNG lưu plaintext —
--   _enc (AES-256-GCM, BYTEA) + _hash (HMAC-SHA256 blind index) + _last4 (hiển thị).
-- Đọc số đầy đủ = endpoint riêng (decrypt + audit READ_PII).
--
-- Retention (docs/03 §7): khách không booking 5 năm → anonymize (cron 7.3);
--   hồ sơ lưu trú/CCCD theo legal-hold (docs/12). Soft-delete mặc định.
-- ============================================================================

CREATE TABLE guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  email CITEXT,
  nationality VARCHAR(2) DEFAULT 'VN',
  id_document_type VARCHAR(20),                  -- CCCD, PASSPORT, CMND
  id_document_number_enc BYTEA,                  -- AES-256-GCM (prefix key_id) — KHÔNG plaintext
  id_document_number_hash BYTEA,                 -- HMAC-SHA256 (khoá riêng) — blind index exact-match
  id_document_last4 VARCHAR(4),                  -- hiển thị ****1234
  id_document_issue_date DATE,
  id_document_issue_place VARCHAR(255),
  id_document_scan_url TEXT,                      -- key storage tier VN (ADR-0004), pre-signed 15'
  date_of_birth DATE,
  gender VARCHAR(10),
  address TEXT,
  notes TEXT,
  is_blacklisted BOOLEAN NOT NULL DEFAULT false,
  blacklist_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id)
);

CREATE INDEX idx_guests_phone ON guests (tenant_id, phone);
CREATE INDEX idx_guests_doc_hash ON guests (tenant_id, id_document_number_hash);
CREATE INDEX idx_guests_name_trgm ON guests USING gin (full_name gin_trgm_ops);  -- search ?q=

CREATE TRIGGER guests_set_updated_at
  BEFORE UPDATE ON guests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enforce_tenant_isolation('guests');
