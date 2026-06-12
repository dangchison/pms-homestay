-- Up Migration
-- ============================================================================
-- 0017 — Transactional Outbox v2 (task 4.2)
-- DDL docs/03 §4.10, cơ chế docs/10 §3. Outbox = insert event CÙNG transaction
-- với entity → commit là cả hai cùng tồn tại; dispatcher gửi sau (SSE + 4.4
-- notification). Vòng đời: PENDING → (claim FOR UPDATE SKIP LOCKED) PROCESSING →
-- PROCESSED | FAILED. Sweep: PROCESSING quá 60s (worker crash) → PENDING + retry.
--
-- KHÔNG RLS (giống webhook_events_received ở 0012): dispatcher claim CROSS-TENANT
-- bằng một query ORDER BY created_at — không có GUC app.current_tenant_id nên RLS
-- sẽ chặn hết (NULLIF → NULL). tenant_id chỉ để route fan-out SSE; publish() set
-- tenant_id từ current_setting trong tenant-tx nên vẫn nhất quán. Bảng chỉ
-- dispatcher (hệ thống) chạm — không có endpoint tenant-facing đọc trực tiếp.
--
-- Retention (docs/03 §7, docs/10 §8): PROCESSED giữ 7 ngày, FAILED 90 ngày
-- (night-audit dọn — OutboxService.purgeOld). Index partial CHỈ trên
-- PENDING/PROCESSING để bảng phình to không làm chậm claim.
-- ============================================================================

CREATE TABLE outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  event_type VARCHAR(64) NOT NULL,               -- booking.created, payment.received, ...
  aggregate_type VARCHAR(64) NOT NULL,
  aggregate_id UUID NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED')),
  claimed_at TIMESTAMPTZ,                         -- lúc dispatcher claim — phục vụ reclaim sweep
  processed_at TIMESTAMPTZ,
  retry_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Claim ORDER BY created_at chỉ quét hàng PENDING; sweep chỉ quét PROCESSING.
CREATE INDEX idx_outbox_pending ON outbox_events (status, created_at) WHERE status = 'PENDING';
CREATE INDEX idx_outbox_stuck ON outbox_events (claimed_at) WHERE status = 'PROCESSING';

-- Đánh thức dispatcher tức thì sau INSERT (poll 5s chỉ là fallback khi mất NOTIFY)
-- — docs/10 §3. Payload = id (dispatcher bỏ qua, chỉ kick batch claim).
CREATE OR REPLACE FUNCTION notify_outbox() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('outbox_new', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_outbox_notify AFTER INSERT ON outbox_events
  FOR EACH ROW EXECUTE FUNCTION notify_outbox();
