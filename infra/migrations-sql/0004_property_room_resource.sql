-- Up Migration
-- ============================================================================
-- 0004 — Property / Room / Bookable Unit + Occupancy (task 2.1)
-- DDL theo docs/03 §4.3, mô hình bookable unit + presence-based occupancy
-- ([ADR-0006]), composite FK ([ADR-0005]), RLS template (docs/02).
--
-- Bao gồm: bổ sung FK (tenant_id, property_id) → properties cho
-- user_property_roles (đã hoãn ở task 1.6 vì properties chưa tồn tại).
--
-- Retention (docs/03 §7):
--   properties / rooms / bookable_resources : vĩnh viễn (master data, soft-delete)
--   resource_members                        : vĩnh viễn (cấu hình)
--   room_blocks                             : dọn > 90 ngày sau end_at (night-audit 4.6)
--   room_occupancy                           : KHÔNG retention riêng — hàng bị xoá khi
--     booking/block về terminal-state (OccupancyService là choke-point duy nhất)
-- ============================================================================

-- ── ENUM ────────────────────────────────────────────────────────────────────
CREATE TYPE property_type AS ENUM ('HOMESTAY', 'RENT_TO_RENT', 'APARTMENT', 'HOTEL');

-- Trạng thái BUỒNG PHÒNG (housekeeping). Trạng thái "đang có khách / trống / block"
-- KHÔNG lưu ở đây — luôn derive từ room_occupancy/room_blocks để không drift.
CREATE TYPE housekeeping_status AS ENUM ('CLEAN', 'DIRTY', 'CLEANING', 'INSPECTION');

CREATE TYPE bookable_resource_type AS ENUM ('ROOM', 'WHOLE');

-- ----------------------------------------------------------------------------
-- properties — cơ sở lưu trú
-- ----------------------------------------------------------------------------
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(255) NOT NULL,
  property_type property_type NOT NULL,
  address_line VARCHAR(500) NOT NULL,
  ward VARCHAR(100),
  district VARCHAR(100),
  province VARCHAR(100) NOT NULL,                -- bắt buộc để báo cáo công an
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',  -- pricing tính ngày theo TZ này

  -- Rent-to-Rent (thuê lại để cho thuê)
  is_rent_to_rent BOOLEAN NOT NULL DEFAULT false,
  landlord_name VARCHAR(255),
  landlord_phone VARCHAR(20),
  rent_to_rent_contract_start DATE,
  rent_to_rent_contract_end DATE,
  monthly_landlord_rent_vnd BIGINT,

  police_business_code VARCHAR(50),              -- mã cơ sở khai báo lưu trú

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id)                         -- anchor cho composite FK (ADR-0005)
);

CREATE INDEX idx_properties_tenant ON properties (tenant_id) WHERE deleted_at IS NULL;

CREATE TRIGGER properties_set_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enforce_tenant_isolation('properties');

-- ----------------------------------------------------------------------------
-- FK (tenant_id, property_id) → properties cho user_property_roles
-- (đã hoãn ở task 1.6 — TODO trong migration 0003 nay hoàn tất)
-- ----------------------------------------------------------------------------
ALTER TABLE user_property_roles
  ADD CONSTRAINT fk_upr_property
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id);

-- ----------------------------------------------------------------------------
-- rooms — phòng VẬT LÝ (không có giá, không có rent_mode, không có availability)
-- ----------------------------------------------------------------------------
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  property_id UUID NOT NULL,
  room_number VARCHAR(50) NOT NULL,
  display_name VARCHAR(255),
  description TEXT,
  housekeeping_status housekeeping_status NOT NULL DEFAULT 'CLEAN',
  capacity_adults INT NOT NULL DEFAULT 2,
  capacity_children INT NOT NULL DEFAULT 0,
  size_sqm DECIMAL(6, 2),
  amenities JSONB NOT NULL DEFAULT '[]'::jsonb,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  buffer_minutes INT NOT NULL DEFAULT 0,         -- đệm dọn phòng, áp khi SINH occupancy; 0 cho HOURLY
  notes TEXT,
  version INT NOT NULL DEFAULT 0,                -- optimistic locking (If-Match — docs/05 §4.5)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id)
);

CREATE UNIQUE INDEX uq_rooms_property_number_live ON rooms (property_id, room_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_rooms_property ON rooms (tenant_id, property_id) WHERE deleted_at IS NULL;

CREATE TRIGGER rooms_set_updated_at
  BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enforce_tenant_isolation('rooms');

-- ----------------------------------------------------------------------------
-- bookable_resources — đơn vị BÁN ĐƯỢC (ADR-0006). Booking đặt resource, KHÔNG đặt room.
-- Tạo room → tự sinh 1 resource type=ROOM map 1:1; bật bán nguyên căn → resource WHOLE.
-- ----------------------------------------------------------------------------
CREATE TABLE bookable_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  property_id UUID NOT NULL,
  type bookable_resource_type NOT NULL,          -- ROOM | WHOLE
  name VARCHAR(255) NOT NULL,                    -- "Phòng 101" | "Nguyên căn Villa A"
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id)
);

CREATE INDEX idx_resources_property ON bookable_resources (tenant_id, property_id) WHERE deleted_at IS NULL;

CREATE TRIGGER bookable_resources_set_updated_at
  BEFORE UPDATE ON bookable_resources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enforce_tenant_isolation('bookable_resources');

-- ----------------------------------------------------------------------------
-- resource_members — resource chiếm những phòng vật lý nào
-- ROOM → 1 phòng; WHOLE → tất cả phòng của căn
-- ----------------------------------------------------------------------------
CREATE TABLE resource_members (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  resource_id UUID NOT NULL,
  room_id UUID NOT NULL,
  PRIMARY KEY (resource_id, room_id),
  FOREIGN KEY (tenant_id, resource_id) REFERENCES bookable_resources (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, room_id) REFERENCES rooms (tenant_id, id)
);

CREATE INDEX idx_resource_members_room ON resource_members (room_id);

SELECT enforce_tenant_isolation('resource_members');

-- ----------------------------------------------------------------------------
-- room_blocks — chặn phòng không do booking (bảo trì, owner dùng)
-- Không có EXCLUDE riêng/trigger cross-check: block ghi vào room_occupancy(block_id)
-- trong cùng tx → EXCLUDE chung tự chặn xung đột block↔booking và block↔block.
-- ----------------------------------------------------------------------------
CREATE TABLE room_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  room_id UUID NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  reason VARCHAR(255) NOT NULL,                  -- MAINTENANCE, OWNER_USE, RENOVATION
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES rooms (tenant_id, id)
);

CREATE INDEX idx_room_blocks_room ON room_blocks (tenant_id, room_id);

SELECT enforce_tenant_isolation('room_blocks');

-- ----------------------------------------------------------------------------
-- room_occupancy — NGUỒN SỰ THẬT chống overbooking (presence-based, ADR-0006)
-- Hàng tồn tại ⇔ khoảng thời gian bị chặn. KHÔNG có cột status.
-- EXCLUDE vô điều kiện chặn mọi xung đột — kể cả chéo WHOLE↔ROOM.
--
-- LƯU Ý: FK (tenant_id, booking_id) → bookings KHÔNG tạo ở đây — bảng bookings
-- chưa tồn tại (đến task 2.6). Task 2.6 sẽ ALTER ADD FK đó. Ở 2.1 chỉ có FK tới
-- room_blocks + rooms; CHECK one-of vẫn bảo đảm đúng một nguồn.
-- ----------------------------------------------------------------------------
CREATE TABLE room_occupancy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  room_id UUID NOT NULL,
  booking_id UUID,
  block_id UUID,
  period TSTZRANGE NOT NULL,                     -- ĐÃ bao gồm buffer_minutes
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((booking_id IS NOT NULL) <> (block_id IS NOT NULL)),  -- đúng một nguồn
  FOREIGN KEY (tenant_id, room_id) REFERENCES rooms (tenant_id, id),
  FOREIGN KEY (tenant_id, block_id) REFERENCES room_blocks (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT room_occupancy_no_overlap EXCLUDE USING gist (room_id WITH =, period WITH &&)
);

CREATE INDEX idx_occupancy_booking ON room_occupancy(booking_id);
CREATE INDEX idx_occupancy_block ON room_occupancy(block_id);

SELECT enforce_tenant_isolation('room_occupancy');
