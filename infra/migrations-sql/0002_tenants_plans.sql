-- Up Migration
-- ============================================================================
-- 0002 — subscription_plans + tenants (task 1.4, docs/02 §tenant-lifecycle, docs/03)
-- Bảng GLOBAL (không tenant_id, KHÔNG RLS) — chỉ platform/billing đụng tới.
-- Retention: vĩnh viễn (master data); tenant CHURNED xử lý theo docs/02 §offboard.
-- ============================================================================

CREATE TABLE subscription_plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              VARCHAR(32) UNIQUE NOT NULL, -- FREE | STARTER | PRO | ENTERPRISE
  name              VARCHAR(128) NOT NULL,
  max_properties    INT NOT NULL CHECK (max_properties >= 0),
  max_rooms         INT NOT NULL CHECK (max_rooms >= 0),
  max_users         INT NOT NULL CHECK (max_users >= 0),
  monthly_price_vnd BIGINT NOT NULL CHECK (monthly_price_vnd >= 0),
  features          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER subscription_plans_set_updated_at
  BEFORE UPDATE ON subscription_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE tenants (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 VARCHAR(64) UNIQUE NOT NULL
                         CHECK (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  display_name         VARCHAR(255) NOT NULL,
  business_type        VARCHAR(32), -- HOMESTAY | RENT_TO_RENT | APARTMENT | MIXED
  status               VARCHAR(16) NOT NULL DEFAULT 'TRIAL'
                         CHECK (status IN ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CHURNED')),
  subscription_plan_id UUID REFERENCES subscription_plans(id),
  trial_ends_at        TIMESTAMPTZ, -- set khi đăng ký (14 ngày); night-audit/billing cron enforce
  timezone             VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  currency             CHAR(3) NOT NULL DEFAULT 'VND',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER tenants_set_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_tenants_status ON tenants (status);
CREATE INDEX idx_tenants_plan ON tenants (subscription_plan_id);
