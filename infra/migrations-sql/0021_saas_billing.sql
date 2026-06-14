-- Up Migration
-- ============================================================================
-- 0021 — Billing-lite SaaS (task 4.7)
-- docs/02 §6 (tenant lifecycle) + docs/14 §4.7. Vòng đời thuê bao nền tảng:
--   TRIAL ──(trial_ends_at quá hạn)──→ SUSPENDED ──(thanh toán)──→ ACTIVE
--                                          └──(60 ngày)──→ CHURNED
--   ACTIVE ──(current_period_end quá hạn)──→ SUSPENDED
-- Cron lifecycle (night-audit gọi) chuyển trạng thái; plan-limit guard chặn tạo
-- property/room/user vượt `subscription_plans.max_*`; thu phí = VietQR động (tái
-- dùng VietqrService 3.3), platform admin xác nhận thủ công (chưa cổng tự động).
-- ============================================================================

-- Cột vòng đời thuê bao trên tenants (bảng GLOBAL, không RLS):
--  - suspended_at: mốc vào SUSPENDED → tính 60 ngày để CHURNED.
--  - current_period_end: hạn đã trả tới (ACTIVE quá hạn này → SUSPENDED).
ALTER TABLE tenants ADD COLUMN suspended_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN current_period_end TIMESTAMPTZ;

-- subscription_payments — lịch sử thu phí thuê bao (GLOBAL, KHÔNG RLS như
-- subscription_plans/outbox_events): tenant đọc của mình qua service LỌC tenant_id
-- TƯỜNG MINH; platform admin xác nhận CROSS-TENANT (tìm theo id, không qua GUC).
-- FK tenant_id ON DELETE CASCADE: dữ liệu billing của tenant biến mất cùng tenant
-- (prod không hard-delete tenant — chỉ status CHURNED; cascade chỉ khi teardown/erasure).
CREATE TABLE subscription_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id       UUID REFERENCES subscription_plans(id),
  plan_code     VARCHAR(32) NOT NULL,                 -- snapshot mã gói lúc thu
  amount_vnd    BIGINT NOT NULL CHECK (amount_vnd >= 0),
  period_start  TIMESTAMPTZ NOT NULL,
  period_end    TIMESTAMPTZ NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED')),
  payment_ref   VARCHAR(64) NOT NULL,                 -- mã addInfo VietQR (SUB-xxxx) để đối soát
  confirmed_by  UUID,                                 -- platform_users.id (admin xác nhận)
  confirmed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- payment_ref duy nhất toàn hệ (mã đối soát chuyển khoản).
CREATE UNIQUE INDEX uq_subscription_payments_ref ON subscription_payments (payment_ref);
-- Lịch sử thanh toán của 1 tenant (trang billing): mới nhất trước.
CREATE INDEX idx_subscription_payments_tenant ON subscription_payments (tenant_id, created_at DESC);
-- Đối soát tay của platform: liệt kê PENDING chờ xác nhận.
CREATE INDEX idx_subscription_payments_pending ON subscription_payments (status, created_at) WHERE status = 'PENDING';
