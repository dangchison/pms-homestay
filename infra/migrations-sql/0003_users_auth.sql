-- Up Migration
-- ============================================================================
-- 0003 — IAM: users + user_property_roles + refresh_tokens + platform_users
-- (task 1.6 — DDL theo docs/03 §4.1–4.2, RLS template docs/02, composite FK ADR-0005)
-- Retention: users/platform_users vĩnh viễn (soft-delete); refresh_tokens: xoá
-- bản ghi hết hạn/revoked > 90 ngày (night-audit retention — task 4.6).
-- ============================================================================

-- Roles trong tenant. Admin nền tảng KHÔNG nằm trong enum này (bảng platform_users riêng).
CREATE TYPE user_role AS ENUM ('OWNER', 'MANAGER', 'STAFF', 'HOUSEKEEPER', 'ACCOUNTANT');

-- ----------------------------------------------------------------------------
-- users — thành viên tenant
-- ----------------------------------------------------------------------------
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  email CITEXT NOT NULL,
  phone VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,           -- argon2id
  full_name VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  default_role user_role NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  email_verified_at TIMESTAMPTZ,
  phone_verified_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  failed_login_count INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  two_factor_secret TEXT,                        -- mã hoá AES-256-GCM (ADR-0007)
  two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id)                         -- anchor cho composite FK (ADR-0005)
);

-- partial unique: cho phép tái tạo email sau soft-delete
CREATE UNIQUE INDEX uq_users_tenant_email_live ON users (tenant_id, email) WHERE deleted_at IS NULL;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enforce_tenant_isolation('users');

-- ----------------------------------------------------------------------------
-- user_property_roles — RBAC scoped theo property
-- LƯU Ý: FK (tenant_id, property_id) → properties(tenant_id, id) BỔ SUNG ở
-- migration task 2.1 (bảng properties chưa tồn tại — forward-only, không chặn IAM).
-- ----------------------------------------------------------------------------
CREATE TABLE user_property_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL,
  property_id UUID NOT NULL,
  role user_role NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"grant": [...], "deny": [...]}
  granted_by UUID,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, property_id, role),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id)
  -- TODO(task 2.1): ALTER TABLE user_property_roles
  --   ADD FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id);
);

CREATE INDEX idx_upr_user ON user_property_roles (tenant_id, user_id);
CREATE INDEX idx_upr_property ON user_property_roles (tenant_id, property_id);

SELECT enforce_tenant_isolation('user_property_roles');

-- ----------------------------------------------------------------------------
-- refresh_tokens — rotation chain (docs/04 §2)
-- ----------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL,
  token_hash VARCHAR(255) NOT NULL,              -- SHA256, không lưu plain
  device_fingerprint VARCHAR(255),
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  rotated_to UUID REFERENCES refresh_tokens(id), -- chain để detect reuse + grace window (04 §2)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id)
);

CREATE INDEX idx_refresh_tokens_lookup ON refresh_tokens(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (tenant_id, user_id);

SELECT enforce_tenant_isolation('refresh_tokens');

-- ----------------------------------------------------------------------------
-- platform_users — admin nền tảng, GLOBAL (không tenant_id, KHÔNG RLS),
-- auth riêng, 2FA bắt buộc (enforce ở application — docs/03 §4.1)
-- ----------------------------------------------------------------------------
CREATE TABLE platform_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL,
  password_hash VARCHAR(255) NOT NULL,           -- argon2id
  full_name VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  two_factor_secret TEXT,                        -- mã hoá AES-256-GCM (ADR-0007)
  two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_platform_users_email ON platform_users (email);
