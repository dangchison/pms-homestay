-- Up Migration
-- ============================================================================
-- 0022 — Channels + Resource mappings (task 5.1, docs/03 §4.8)
-- Kênh OTA (iCal Airbnb/Booking/Agoda, hoặc Channex API) + map LISTING↔resource.
--  - channels.config JSONB: secret (api_key) MÃ HOÁ AES-256-GCM (ADR-0007) qua
--    EncryptionService — lưu field `api_key_enc`, KHÔNG bao giờ trả plaintext.
--  - Một LISTING = một bookable_resource (phòng lẻ HOẶC nguyên căn) → map theo
--    resource, không theo phòng vật lý (docs/03 §4.8).
--  - ical_push_token: token bí mật cho endpoint push iCal công khai (5.3) —
--    DEFAULT 24 byte ngẫu nhiên hex; UNIQUE toàn hệ (tra cứu cross-tenant ở 5.3).
--  - sync_jobs/sync_logs (5.2) + bookings.missing_sync_count (5.2): migration sau.
--  - webhook_events_received: đã có ở 0012 (dùng lại cho 5.2 nhận webhook).
--
-- RLS (tenant-scoped): CRUD qua withTenant. Composite FK (tenant_id, ...) khoá
-- liên kết trong cùng tenant. last_sync_status dùng enum sync_job_status (khai ở
-- đây vì channels là nơi đầu tiên cần — sync_jobs 5.2 tái dùng).
-- ============================================================================

CREATE TYPE sync_job_status AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL');

CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  property_id UUID NOT NULL,
  channel_type VARCHAR(32) NOT NULL
    CHECK (channel_type IN ('AIRBNB_ICAL', 'BOOKING_ICAL', 'AGODA_ICAL', 'CHANNEX_API')),
  display_name VARCHAR(255) NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,      -- secret (api_key) mã hoá → api_key_enc (ADR-0007)
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  last_sync_status sync_job_status,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id)
);

CREATE INDEX idx_channels_property ON channels (tenant_id, property_id);

CREATE TRIGGER channels_set_updated_at
  BEFORE UPDATE ON channels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enforce_tenant_isolation('channels');

CREATE TABLE channel_resource_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  channel_id UUID NOT NULL,
  resource_id UUID NOT NULL,
  external_listing_id VARCHAR(255) NOT NULL,
  external_listing_url TEXT,
  ical_pull_url TEXT,                            -- URL iCal pull (bí mật theo listing) — worker 5.2 đọc
  ical_push_token VARCHAR(255) NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_pulled_at TIMESTAMPTZ,
  last_event_count INT NOT NULL DEFAULT 0,       -- state sanity-guard chống feed rỗng (08 §3 — 5.2)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, resource_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, channel_id) REFERENCES channels (tenant_id, id),
  FOREIGN KEY (tenant_id, resource_id) REFERENCES bookable_resources (tenant_id, id)
);

-- Tra cứu cross-tenant theo token cho endpoint push iCal công khai (5.3).
CREATE UNIQUE INDEX idx_ical_push_token ON channel_resource_mappings (ical_push_token);

SELECT enforce_tenant_isolation('channel_resource_mappings');
