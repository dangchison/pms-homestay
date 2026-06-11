-- Up Migration
-- ============================================================================
-- 0009 — Bookings + status history + idempotency keys (task 2.6)
-- DDL theo docs/03 §4.5. Booking đặt RESOURCE (ADR-0006): KHÔNG room_id, KHÔNG
-- EXCLUDE trên bảng này — chống overbooking ở room_occupancy. Booking KHÔNG bao
-- giờ DELETE (terminal: CANCELLED/NO_SHOW/CHECKED_OUT) — audit tài chính.
--
-- ĐỒNG THỜI: ALTER room_occupancy thêm composite FK (tenant_id, booking_id) →
-- bookings (hoãn từ 2.1 vì bookings chưa tồn tại — 2.1 chỉ FK tới room_blocks).
--
-- Retention (docs/03 §7): bookings vĩnh viễn; booking_status_history vĩnh viễn;
-- idempotency_keys cron delete theo expires_at (24h).
-- ============================================================================

CREATE TYPE booking_status AS ENUM (
  'HOLD', 'PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'
);

-- ----------------------------------------------------------------------------
-- bookings
-- ----------------------------------------------------------------------------
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  property_id UUID NOT NULL,                     -- denormalized từ resource (immutable)
  resource_id UUID NOT NULL,                     -- ADR-0006: đặt RESOURCE, không đặt room
  guest_id UUID,
  booking_code VARCHAR(20) NOT NULL,             -- BK-202606-0001 (document_counters)
  source VARCHAR(32) NOT NULL DEFAULT 'DIRECT' CHECK (source IN
    ('DIRECT','WALK_IN','AIRBNB_ICAL','BOOKING_ICAL','AGODA_ICAL','CHANNEX_API','OTHER')),
  external_id VARCHAR(255),
  external_uid VARCHAR(255),                     -- UID iCal
  channel_mapping_id UUID,                       -- mapping OTA (dedup iCal đúng phạm vi)
  status booking_status NOT NULL DEFAULT 'PENDING',
  mode booking_mode NOT NULL,
  rate_plan_id UUID,
  quote_id UUID,                                 -- quote đã verify khi tạo
  check_in TIMESTAMPTZ NOT NULL,
  check_out TIMESTAMPTZ NOT NULL,
  actual_check_in TIMESTAMPTZ,
  actual_check_out TIMESTAMPTZ,
  adults INT NOT NULL DEFAULT 1,
  children INT NOT NULL DEFAULT 0,
  total_amount_vnd BIGINT NOT NULL,              -- snapshot giá đã chốt (READ-ONLY); nợ/đã trả từ invoice+payment
  commission_vnd BIGINT NOT NULL DEFAULT 0,      -- input snapshot; chi phí thực ghi qua expenses (ADR-0003)
  notes TEXT,
  cancellation_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID,
  created_by UUID,
  expires_at TIMESTAMPTZ,                         -- HOLD: now+10'; PENDING: hạn cọc (night-audit dọn)
  missing_sync_count INT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 0,                 -- optimistic locking (If-Match)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (check_out > check_in),
  UNIQUE (tenant_id, booking_code),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id),
  FOREIGN KEY (tenant_id, resource_id) REFERENCES bookable_resources (tenant_id, id),
  FOREIGN KEY (tenant_id, guest_id) REFERENCES guests (tenant_id, id),
  FOREIGN KEY (tenant_id, rate_plan_id) REFERENCES rate_plans (tenant_id, id)
);

-- Dedup iCal theo MAPPING (không global — tránh đụng UID giữa 2 tenant)
CREATE UNIQUE INDEX uq_bookings_external_uid ON bookings (channel_mapping_id, external_uid)
  WHERE external_uid IS NOT NULL;
CREATE INDEX idx_bookings_tenant_status ON bookings (tenant_id, status);
CREATE INDEX idx_bookings_resource_time ON bookings (resource_id, check_in, check_out);
CREATE INDEX idx_bookings_arrivals ON bookings (tenant_id, property_id, check_in)
  WHERE status IN ('PENDING', 'CONFIRMED');
CREATE INDEX idx_bookings_expiry ON bookings (status, expires_at)
  WHERE status IN ('HOLD', 'PENDING') AND expires_at IS NOT NULL;  -- cron HOLD + night-audit
CREATE INDEX idx_bookings_cursor ON bookings (tenant_id, created_at DESC, id DESC);

CREATE TRIGGER bookings_set_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enforce_tenant_isolation('bookings');

-- ----------------------------------------------------------------------------
-- ALTER room_occupancy: FK (tenant_id, booking_id) → bookings (hoãn từ 2.1)
-- ----------------------------------------------------------------------------
ALTER TABLE room_occupancy
  ADD CONSTRAINT room_occupancy_booking_fkey
  FOREIGN KEY (tenant_id, booking_id) REFERENCES bookings (tenant_id, id) ON DELETE CASCADE;

-- ----------------------------------------------------------------------------
-- booking_status_history
-- ----------------------------------------------------------------------------
CREATE TABLE booking_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  booking_id UUID NOT NULL,
  from_status booking_status,
  to_status booking_status NOT NULL,
  changed_by UUID,                               -- NULL = hệ thống (cron/night-audit/sync)
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, booking_id) REFERENCES bookings (tenant_id, id)
);

CREATE INDEX idx_bsh_booking ON booking_status_history (booking_id, created_at);

SELECT enforce_tenant_isolation('booking_status_history');

-- ----------------------------------------------------------------------------
-- idempotency_keys (docs/03 §4, docs/05 §4): POST tạo entity quan trọng
-- ----------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
  key VARCHAR(255) NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID,
  request_path VARCHAR(500) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,             -- SHA256 body
  response_status INT,
  response_body JSONB,
  locked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key, tenant_id)
);

CREATE INDEX idx_idempotency_expires ON idempotency_keys (expires_at);

SELECT enforce_tenant_isolation('idempotency_keys');
