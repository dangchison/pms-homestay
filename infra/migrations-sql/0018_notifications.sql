-- Up Migration
-- ============================================================================
-- 0018 — Notifications (task 4.4)
-- DDL docs/03 §4.10 + cột `event_id` (nguồn outbox — dedup + truy vết). Outbox
-- dispatcher (4.2/4.3) enqueue BullMQ `notifications`; worker route theo event_type
-- → người nhận (role trên property) × kênh (IN_APP/EMAIL; SMS/ZNS stub) → ghi 1 dòng
-- /kênh + side-effect (email SMTP). docs/10 §7.
--
-- RLS (tenant-scoped, user-facing): worker ghi TRONG withTenant(tenant_id); GET
-- /notifications đọc của chính user. Composite FK (tenant_id, user_id) → users.
-- Idempotency: UNIQUE (tenant_id, user_id, channel, event_id) → at-least-once +
-- retry worker INSERT ON CONFLICT DO NOTHING (không gửi đôi / không nhân dòng).
-- Retention (docs/03 §7): notification đã đọc giữ ngắn hạn (dọn sau — chưa bắt buộc).
-- ============================================================================

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL,
  channel VARCHAR(16) NOT NULL CHECK (channel IN ('IN_APP', 'EMAIL', 'SMS', 'ZNS')),
  event_id UUID,                                 -- nguồn outbox_events (NULL nếu tạo tay)
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,   -- event_type + id phục vụ FE điều hướng
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id)
);

-- Danh sách chưa đọc của 1 user (FE badge/inbox)
CREATE INDEX idx_notifications_unread ON notifications (user_id, created_at DESC) WHERE is_read = false;

-- Idempotent: 1 event → tối đa 1 noti mỗi (user, kênh)
CREATE UNIQUE INDEX uq_notifications_event ON notifications (tenant_id, user_id, channel, event_id)
  WHERE event_id IS NOT NULL;

SELECT enforce_tenant_isolation('notifications');
