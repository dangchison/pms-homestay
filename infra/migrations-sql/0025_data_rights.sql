-- Up Migration
-- ============================================================================
-- 0025 — Data-rights Nghị định 13 (task 7.3, docs/12 §4 + docs/03 §4.11)
-- Retention: data_processing_consents giữ theo vòng đời quan hệ (NĐ13 — chứng minh
-- đã lấy đồng ý); anonymize guest qua cột guests.anonymized_at (không xoá dòng để giữ
-- agg booking/hoá đơn không-định-danh).
--
--  - data_processing_consents: bản ghi đồng ý/thu hồi xử lý dữ liệu (BOOKING_PROCESS/
--    MARKETING/ANALYTICS) — lưu full text + SHA256 hash tại thời điểm đồng ý + IP/UA.
--  - guests.anonymized_at: mốc đã ẩn danh (Right to Erasure) — đã ẩn thì bỏ qua sweep.
--  - guests.legal_hold_until: legal-hold matrix (docs/12 §4) — số giấy tờ/CCCD giữ tới
--    hạn luật (vd lưu trú công an/CCCD 5 năm sau lần ở cuối) dù khách yêu cầu xoá; tới
--    hạn thì cron ẩn danh nốt. NULL = không bị giữ.
-- RLS tenant-scoped (CRUD qua withTenant). Composite FK (tenant,guest) chuẩn chung.
-- ============================================================================

CREATE TABLE data_processing_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  guest_id UUID NOT NULL,
  consent_type VARCHAR(64) NOT NULL
    CHECK (consent_type IN ('BOOKING_PROCESS', 'MARKETING', 'ANALYTICS')),
  consent_text_hash VARCHAR(64) NOT NULL,        -- SHA256 của text được đồng ý
  consent_text TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  ip_address INET,
  user_agent TEXT,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, guest_id) REFERENCES guests (tenant_id, id)
);

CREATE INDEX idx_consents_guest ON data_processing_consents (tenant_id, guest_id);

SELECT enforce_tenant_isolation('data_processing_consents');

-- Trạng thái erasure + legal-hold trên guest (task 7.3).
ALTER TABLE guests
  ADD COLUMN anonymized_at TIMESTAMPTZ,
  ADD COLUMN legal_hold_until DATE;
