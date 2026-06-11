-- Up Migration
-- ============================================================================
-- 0006 — Quotes (báo giá persist) (task 2.4)
-- DDL theo docs/03 §4.4. Quote nằm trong DB (KHÔNG Redis — Redis evict là mất
-- quote giữa lúc khách thao tác, docs/07 §6). Tạo booking gửi quote_id → server
-- re-calculate bằng pricing-engine + so version; lệch → 409 PRICE_CHANGED (task 2.6).
--
-- Retention (docs/03 §7): cron dọn quote hết hạn > 7 ngày (gắn night-audit 4.6).
-- ============================================================================

CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  property_id UUID NOT NULL,
  resource_id UUID NOT NULL,
  rate_plan_id UUID NOT NULL,
  rate_plan_version INT NOT NULL,                -- snapshot version lúc báo giá (re-calc xác định)
  mode booking_mode NOT NULL,
  check_in TIMESTAMPTZ NOT NULL,
  check_out TIMESTAMPTZ NOT NULL,
  adults INT NOT NULL DEFAULT 1,
  children INT NOT NULL DEFAULT 0,
  line_items JSONB NOT NULL,                     -- breakdown đầy đủ (đồng bộ pricing-engine)
  subtotal_vnd BIGINT NOT NULL,
  discount_vnd BIGINT NOT NULL DEFAULT 0,
  tax_vnd BIGINT NOT NULL DEFAULT 0,
  total_vnd BIGINT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,               -- now() + 15 phút
  used_by_booking_id UUID,                       -- set khi booking tạo thành công (task 2.6)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (check_out > check_in),
  FOREIGN KEY (tenant_id, resource_id) REFERENCES bookable_resources (tenant_id, id),
  FOREIGN KEY (tenant_id, rate_plan_id) REFERENCES rate_plans (tenant_id, id)
);

-- partial index phục vụ cron dọn quote chưa dùng đã hết hạn
CREATE INDEX idx_quotes_expiry ON quotes (expires_at) WHERE used_by_booking_id IS NULL;

SELECT enforce_tenant_isolation('quotes');
