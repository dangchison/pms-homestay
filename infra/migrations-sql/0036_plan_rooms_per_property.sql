-- Up Migration
-- ============================================================================
-- 0036 — subscription_plans.max_rooms_per_property: trần phòng TỪNG CƠ SỞ
--
-- Trước đây gói chỉ có `max_rooms` = tổng phòng toàn tenant, nên gói "3 cơ sở,
-- mỗi cơ sở tối đa N phòng" không diễn đạt được: khách dồn hết phòng vào một cơ
-- sở vẫn lọt. Cột mới chặn theo từng property; `max_rooms` GIỮ NGUYÊN vai trò
-- trần tổng (hai trần độc lập, vi phạm trần nào chặn trần đó).
--
-- Backfill = max_rooms → gói cũ giữ nguyên hành vi (trần cơ sở ≥ trần tổng nên
-- không bao giờ chạm trước). Seed `pnpm db:seed:required` ghi đè bằng số chính
-- thức ngay sau migration.
--
-- Additive, forward-only, bảng GLOBAL không RLS (0002). KHÔNG PII.
-- ============================================================================

ALTER TABLE subscription_plans
  ADD COLUMN max_rooms_per_property INT NOT NULL DEFAULT 0
    CHECK (max_rooms_per_property >= 0);

UPDATE subscription_plans SET max_rooms_per_property = max_rooms;

-- DEFAULT chỉ để ALTER chạy được trên bảng có sẵn; gói mới phải khai báo tường minh.
ALTER TABLE subscription_plans
  ALTER COLUMN max_rooms_per_property DROP DEFAULT;

COMMENT ON COLUMN subscription_plans.max_rooms_per_property IS
  'Trần số phòng của MỘT cơ sở. Khác max_rooms (trần tổng toàn tenant) — cả hai cùng được enforce trong tx tạo phòng (subscription.service.assertRoomWithinPlanTx).';
