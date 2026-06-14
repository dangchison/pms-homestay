-- Up Migration
-- ============================================================================
-- 0020 — Audit log (task 4.5)
-- DDL docs/03 §audit_logs. Bảng vết kiểm toán — ghi tự động MỌI mutation
-- (POST/PATCH/DELETE) qua AuditInterceptor (pha sau handler, redact PII) + các
-- action tường minh từ service (READ_PII khi giải mã số giấy tờ — guests.service;
-- LOGIN/LOGOUT/EXPORT bổ sung sau). Đọc qua GET /audit-logs (quyền audit_log.read).
--
-- ► APPEND-ONLY: chỉ tạo policy SELECT + INSERT (KHÔNG policy UPDATE/DELETE) →
--   FORCE RLS từ chối mọi UPDATE/DELETE (thấy 0 dòng) kể cả owner. Không gọi
--   enforce_tenant_isolation() vì hàm đó còn tạo policy ALL (cho phép sửa/xoá).
--   Không REVOKE trên app_user: migrations chạy bằng postgres, KHÔNG tham chiếu
--   role runtime (giữ migration chạy được ở mọi môi trường) — RLS đủ chặn.
--
-- ► PARTITION theo tháng (docs/03 §7): đây là bảng lớn nhất hệ thống theo thời
--   gian. PARTITION BY RANGE (created_at) ⇒ PK BẮT BUỘC gồm cột phân vùng →
--   PRIMARY KEY (id, created_at). Index + FK + RLS khai trên parent, áp cho mọi
--   partition (kể cả tạo sau). App chỉ chạm bảng cha `audit_logs` (không truy
--   vấn partition trực tiếp) nên RLS trên parent là đủ. Retention: detach
--   partition cũ → dump S3 (giữ ≥10 năm — nghĩa vụ thuế); chưa bắt buộc ở task này.
--
-- ► FK tenant_id ON DELETE CASCADE: interceptor ghi audit cho MỌI tenant bị bất
--   kỳ mutation chạm tới → bảng tham chiếu rộng nhất hệ thống. Prod KHÔNG bao giờ
--   hard-delete tenant (billing-lite 4.7: vòng đời SUSPENDED→CHURNED, đổi status
--   chứ không xoá) ⇒ CASCADE chỉ kích hoạt khi (a) e2e teardown dọn tenant, (b)
--   xoá dữ liệu thật theo quyền chủ thể NĐ13 — cả hai đều ĐÚNG khi vết kiểm toán
--   của tenant biến mất cùng tenant. Tránh bắt 21 file e2e phải nhớ dọn audit_logs
--   trước khi xoá tenant (fragility "afterAll-FK" đã gặp ở cleaning_tasks).
-- ============================================================================

CREATE TYPE audit_action AS ENUM (
  'CREATE', 'UPDATE', 'DELETE', 'STATE_CHANGE', 'LOGIN', 'LOGOUT', 'EXPORT', 'READ_PII'
);

CREATE TABLE audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID,                                  -- NULL = hệ thống (cron/night-audit)
  action audit_action NOT NULL,                  -- gồm cả READ_PII
  entity_type VARCHAR(64) NOT NULL,              -- 'bookings', 'guests', 'cleaning-tasks', ...
  entity_id UUID,
  before_data JSONB,                             -- ĐÃ redact PII trước khi ghi (docs/11 §2)
  after_data JSONB,                              -- ĐÃ redact PII (payload thay đổi)
  diff JSONB,
  ip_address INET,
  user_agent TEXT,
  request_id VARCHAR(64),                        -- nối với pino request_id (X-Request-Id)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at),                  -- PK gồm cột phân vùng (bắt buộc với partition)
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
) PARTITION BY RANGE (created_at);

-- Tra cứu theo entity (timeline 1 booking/guest/...) + theo tenant + thời gian.
CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_tenant_time ON audit_logs (tenant_id, created_at DESC);
-- Lọc theo người thực hiện (ai làm gì) — bổ trợ GET /audit-logs filter user_id.
CREATE INDEX idx_audit_user ON audit_logs (tenant_id, user_id, created_at DESC) WHERE user_id IS NOT NULL;

-- RLS append-only: SELECT + INSERT theo tenant; KHÔNG có policy UPDATE/DELETE.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Tạo sẵn partition tháng cho cửa sổ 2026-01 .. 2027-12 (phủ hiện tại + ~1.5 năm
-- tới). Partition tạo sau (night-audit / migration mới) tự thừa kế index+RLS+FK.
DO $$
DECLARE
  m date := date '2026-01-01';
  part_name text;
BEGIN
  WHILE m < date '2028-01-01' LOOP
    part_name := 'audit_logs_' || to_char(m, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
      part_name, m, (m + interval '1 month')::date
    );
    m := (m + interval '1 month')::date;
  END LOOP;
END $$;

-- DEFAULT partition: lưới an toàn — INSERT ngoài cửa sổ trên không bao giờ fail
-- (ghi audit best-effort vẫn vào được). Cửa sổ pre-create rộng nên default rỗng
-- nhiều năm → vẫn attach được partition tháng mới khi cần.
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;
