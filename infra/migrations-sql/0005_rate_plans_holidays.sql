-- Up Migration
-- ============================================================================
-- 0005 — Rate Plans + Rules + Resource assignment + vietnam_holidays (task 2.2)
-- DDL theo docs/03 §4.4 + §4.1, pricing model docs/07. Giá gán theo BOOKABLE
-- RESOURCE (ADR-0006), KHÔNG theo room.
--
-- Retention (docs/03 §7):
--   rate_plans / rate_plan_rules / rate_plan_resources : vĩnh viễn (cấu hình giá,
--     phục vụ re-calc/audit tranh chấp giá — chỉ deactivate, không xoá khi đã dùng)
--   vietnam_holidays : vĩnh viễn (master data, cập nhật yearly)
-- ============================================================================

-- booking_mode dùng cho rate_plans (và bookings task 2.6). booking_status để 2.6.
CREATE TYPE booking_mode AS ENUM ('HOURLY', 'DAILY', 'MONTHLY');

-- ----------------------------------------------------------------------------
-- vietnam_holidays — lịch lễ/nghỉ bù, GLOBAL (không tenant_id, KHÔNG RLS),
-- NGUỒN DUY NHẤT cho pricing (docs/03 §4.1, docs/07 §4). KHÔNG hardcode trong
-- packages/pricing-engine — engine nhận holidays qua input.
-- ----------------------------------------------------------------------------
CREATE TABLE vietnam_holidays (
  holiday_date DATE PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  is_substitute BOOLEAN NOT NULL DEFAULT false,  -- ngày nghỉ bù do Chính phủ công bố
  source VARCHAR(64),                            -- văn bản công bố
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- rate_plans — gói giá theo (property, mode), gán cho resource (rate_plan_resources)
-- KHÔNG soft-delete (dùng is_active); version bump khi sửa giá (docs/07 §6).
-- ----------------------------------------------------------------------------
CREATE TABLE rate_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  property_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  mode booking_mode NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  version INT NOT NULL DEFAULT 1,                -- bump khi sửa giá → quote/booking cũ re-calc xác định

  base_price_vnd BIGINT NOT NULL,

  -- Cọc (sinh DEPOSIT invoice — ADR-0003)
  deposit_type VARCHAR(16) NOT NULL DEFAULT 'NONE' CHECK (deposit_type IN ('NONE', 'FIXED', 'PERCENT')),
  deposit_value BIGINT NOT NULL DEFAULT 0,       -- VND nếu FIXED; basis point nếu PERCENT (3000 = 30%)

  -- HOURLY
  hourly_base_hours INT,
  hourly_extra_block_minutes INT,                -- 30 hoặc 60
  hourly_extra_block_price_vnd BIGINT,
  hourly_overnight_surcharge_vnd BIGINT,
  hourly_overnight_start TIME,                   -- 22:00
  hourly_overnight_end TIME,                     -- 06:00

  -- DAILY
  daily_checkin_time TIME DEFAULT '14:00',
  daily_checkout_time TIME DEFAULT '12:00',
  daily_early_checkin_fee_vnd BIGINT,
  daily_late_checkout_fee_vnd BIGINT,

  -- MONTHLY
  monthly_includes_utilities BOOLEAN DEFAULT false,
  monthly_electricity_per_kwh_vnd BIGINT,        -- default = giá EVN (docs/12 §7)
  monthly_water_per_m3_vnd BIGINT,

  effective_from DATE NOT NULL,
  effective_to DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id)
);

-- Bắt buộc TỐI ĐA 1 default per (property, mode) — service đảm bảo TỐI THIỂU 1.
CREATE UNIQUE INDEX uq_rate_plan_default ON rate_plans (tenant_id, property_id, mode) WHERE is_default;
CREATE INDEX idx_rate_plans_property ON rate_plans (tenant_id, property_id);

CREATE TRIGGER rate_plans_set_updated_at
  BEFORE UPDATE ON rate_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enforce_tenant_isolation('rate_plans');

-- ----------------------------------------------------------------------------
-- rate_plan_rules — luật giá theo ngày/mùa/lễ (docs/07 §4)
-- Validation khi ghi: CẤM 2 rule cùng priority chồng ngày (service-side).
-- Tie-break phòng hờ khi áp giá: priority DESC, created_at ASC.
-- ----------------------------------------------------------------------------
CREATE TABLE rate_plan_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  rate_plan_id UUID NOT NULL,
  rule_type VARCHAR(32) NOT NULL CHECK (rule_type IN
    ('WEEKDAY', 'WEEKEND', 'HOLIDAY', 'SEASON', 'DATE_RANGE')),
  start_date DATE,
  end_date DATE,
  days_of_week INT[],                            -- [0..6], 0=Sunday
  price_modifier_type VARCHAR(16) NOT NULL CHECK (price_modifier_type IN
    ('FIXED', 'PERCENT', 'OVERRIDE')),
  price_modifier_value BIGINT NOT NULL,          -- PERCENT theo basis point (1500 = +15%)
  priority INT NOT NULL DEFAULT 0,               -- cao hơn thắng
  notes VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  FOREIGN KEY (tenant_id, rate_plan_id) REFERENCES rate_plans (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_rate_plan_rules_plan ON rate_plan_rules (tenant_id, rate_plan_id);

SELECT enforce_tenant_isolation('rate_plan_rules');

-- ----------------------------------------------------------------------------
-- rate_plan_resources — gán gói giá cho bookable resource (theo resource, ADR-0006)
-- ----------------------------------------------------------------------------
CREATE TABLE rate_plan_resources (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  rate_plan_id UUID NOT NULL,
  resource_id UUID NOT NULL,
  PRIMARY KEY (rate_plan_id, resource_id),
  FOREIGN KEY (tenant_id, rate_plan_id) REFERENCES rate_plans (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, resource_id) REFERENCES bookable_resources (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_rate_plan_resources_resource ON rate_plan_resources (resource_id);

SELECT enforce_tenant_isolation('rate_plan_resources');
