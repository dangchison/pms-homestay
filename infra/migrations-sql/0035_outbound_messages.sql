-- Up Migration
-- ============================================================================
-- 0035 — outbound_messages (Đợt 4 / M1, docs/18) — sổ gửi kênh ngoài (SMS/ZNS/EMAIL)
-- DDL docs/03 §4 (notifications). Ghi 1 dòng mỗi lần "gửi" qua provider ngoài
-- (mock/log/zalo/esms/smtp) — nguồn truy vết + audit kênh gửi. NotificationsService
-- (task 4.4) nay gọi NotificationProviderRegistry.forChannel(channel).send() NGOÀI tx
-- (ADR-0002) rồi ghi 1 dòng vào bảng này. EMAIL vẫn qua SmtpEmailProvider→MailService.
--
-- Đợt 4 chạy mock/sandbox theo env (SMS_PROVIDER/ZNS_PROVIDER, mặc định 'mock') —
-- KHÔNG cần credentials thật; esms/zalo là slot creds Phase sau (registry ném rõ ràng).
--
-- Composite FK NULLABLE (ADR-0005): (tenant_id, booking_id) → bookings, (tenant_id,
-- guest_id) → guests — chỉ enforce khi có giá trị (SMS/ZNS route theo user thường
-- KHÔNG kèm booking/guest; điền khi payload có). event_id NULL (nguồn outbox, không
-- FK vì outbox_events là bảng global non-RLS).
--
-- PII: recipient chứa số ĐT/email/zalo id (PII mức thấp, như notifications.metadata
-- đã chứa payload). GET /notifications/outbound gated 'audit_log.read' (OWNER +
-- ACCOUNTANT). KHÔNG lưu nội dung nhạy cảm ngoài title/body template.
--
-- RLS (docs/02 §RLS): bảng PER-TENANT — mọi ghi/đọc qua withTenant (set GUC
-- app.current_tenant_id); enforce_tenant_isolation áp policy tenant_isolation +
-- tenant_isolation_insert (NULLIF template). INSERT set tenant_id từ GUC (như
-- notifications). Retention (docs/03 §7): 90 ngày — night-audit.cleanupRetention dọn
-- per-tenant (bảng RLS, KHÔNG dùng MaintenanceService vốn cho bảng global).
-- ============================================================================

CREATE TABLE outbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  channel VARCHAR(16) NOT NULL CHECK (channel IN ('SMS', 'ZNS', 'EMAIL')),
  provider VARCHAR(16) NOT NULL,                 -- mock | log | zalo | esms | smtp
  provider_message_id VARCHAR(255),              -- id từ provider (NULL cho log/best-effort)
  recipient TEXT NOT NULL,                       -- email / số ĐT / zalo id (fallback user id/email)
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  error_reason TEXT,
  event_id UUID,                                 -- nguồn outbox_events (NULL nếu gửi tay)
  booking_id UUID,                               -- NULL nếu không gắn booking
  guest_id UUID,                                 -- NULL nếu không gắn guest
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,   -- event_type/user_id/payload phụ trợ
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Composite FK NULLABLE (ADR-0005): chỉ enforce khi có giá trị
  FOREIGN KEY (tenant_id, booking_id) REFERENCES bookings (tenant_id, id),
  FOREIGN KEY (tenant_id, guest_id) REFERENCES guests (tenant_id, id)
);

-- Danh sách theo tenant, mới nhất trước (REST GET /notifications/outbound)
CREATE INDEX idx_outbound_messages_tenant_created ON outbound_messages (tenant_id, created_at DESC);

CREATE TRIGGER outbound_messages_set_updated_at
  BEFORE UPDATE ON outbound_messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enforce_tenant_isolation('outbound_messages');
