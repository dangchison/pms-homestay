-- Up Migration
-- ============================================================================
-- 0019 — Cleaning tasks (task 4.1)
-- DDL docs/03 §4.9. Việc dọn phòng sinh tự động khi booking CHECKED_OUT (+ phòng
-- cũ khi switch-resource — gọi TRONG tx ở bookings.service), CRUD + assign thủ
-- công; vòng đời PENDING→IN_PROGRESS→COMPLETED→VERIFIED (+ CANCELLED). Ảnh
-- before/after lưu key S3 (JSONB string[]) — client upload qua pre-signed PUT.
--
-- housekeeping_status của phòng đi kèm trạng thái task (docs/14 §4.1):
--   PENDING→DIRTY · IN_PROGRESS→CLEANING · COMPLETED→INSPECTION · VERIFIED→CLEAN.
--
-- KHÔNG sinh room_block (docs/03 §4.9): đệm dọn phòng đã xử lý bằng
-- rooms.buffer_minutes khi sinh occupancy — block sẽ chặn sai booking back-to-back
-- hợp lệ (nhất là HOURLY).
--
-- RLS (tenant-scoped): mọi truy cập qua withTenant; composite FK
-- (tenant_id, property_id|room_id|booking_id) khoá liên kết trong cùng tenant.
-- Retention (docs/03 §7): task vận hành — giữ ngắn hạn, dọn sau (chưa bắt buộc).
-- ============================================================================

-- Enum trạng thái task (docs/03 §4): chỉ khai báo ở đây — 0004 chưa tạo vì bảng
-- cleaning_tasks tới task 4.1 mới có.
CREATE TYPE cleaning_task_status AS ENUM (
  'PENDING', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CANCELLED'
);

CREATE TABLE cleaning_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  property_id UUID NOT NULL,
  room_id UUID NOT NULL,
  booking_id UUID,                               -- task sinh sau booking nào (NULL = thủ công)
  task_type VARCHAR(32) NOT NULL DEFAULT 'CHECKOUT_CLEAN'
    CHECK (task_type IN ('CHECKOUT_CLEAN', 'DEEP_CLEAN', 'MAINTENANCE')),
  status cleaning_task_status NOT NULL DEFAULT 'PENDING',
  assigned_to UUID,
  priority INT NOT NULL DEFAULT 0,
  due_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  notes TEXT,
  before_photos JSONB NOT NULL DEFAULT '[]'::jsonb,  -- string[] key S3 (ảnh trước dọn)
  after_photos JSONB NOT NULL DEFAULT '[]'::jsonb,   -- string[] key S3 (ảnh sau dọn)
  version INT NOT NULL DEFAULT 0,                    -- If-Match (docs/05 §4.5)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES rooms (tenant_id, id),
  FOREIGN KEY (tenant_id, booking_id) REFERENCES bookings (tenant_id, id)
);

-- Hàng đợi việc của 1 nhân viên (FE app dọn phòng): chỉ task chưa xong.
CREATE INDEX idx_cleaning_assigned_pending ON cleaning_tasks (assigned_to, status)
  WHERE status IN ('PENDING', 'IN_PROGRESS');

-- Bảng điều phối theo cơ sở: lọc property + status, mới nhất trước.
CREATE INDEX idx_cleaning_property ON cleaning_tasks (tenant_id, property_id, created_at DESC);

CREATE TRIGGER cleaning_tasks_set_updated_at
  BEFORE UPDATE ON cleaning_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enforce_tenant_isolation('cleaning_tasks');
