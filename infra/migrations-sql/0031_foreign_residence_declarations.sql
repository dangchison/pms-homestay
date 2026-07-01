-- Up Migration
-- ============================================================================
-- 0031 — Khai báo TẠM TRÚ khách NƯỚC NGOÀI (XNC) — task 9.3, docs/12 §2
-- KHÁC báo cáo lưu trú công an TT56 (cột bookings.police_report_status, 0028):
-- đó là thông báo lưu trú cấp xã cho MỌI khách; đây là nghĩa vụ RIÊNG với khách
-- nước ngoài — khai báo tạm trú lên Cục Quản lý xuất nhập cảnh (cổng
-- khaibaotamtru.xuatnhapcanh.gov.vn, mẫu NA17), cần dữ liệu thị thực + nhập cảnh
-- mà guests/bookings chưa có. Một khách nước ngoài cần CẢ HAI (song song).
--
-- Mỗi declaration = 1 stay (booking) của khách nước ngoài (= guest chính của booking).
-- Dữ liệu PER-STAY (visa/nhập cảnh) → bảng riêng (KHÔNG nhét vào bookings — cột thưa
-- chỉ cho khách NN; cũng KHÔNG vào guests — visa/nhập cảnh đổi theo từng lần nhập).
-- Định danh (họ tên/hộ chiếu/quốc tịch/DOB) KHÔNG denormalize: tham chiếu guest_id,
-- giải mã LIVE khi xuất NA17 (như police-report) → không nhân bản PII mã hoá.
-- Chỉ SỐ thị thực mã hoá field (ADR-0007, cùng lớp số giấy tờ); type/expiry/nhập
-- cảnh là cột thường (như guests lưu DOB/issue_date dạng thường).
--
-- Vòng đời: DRAFT (đang nhập NA17) → SUBMITTED (đã khai) | FAILED (thiếu dữ liệu).
-- Phase 1 = lễ tân nhập + xuất NA17 cho cổng XNC (thủ công); Phase 2 (creds) = POST
-- API XNC (NGOÀI withTenant — I/O), lưu xnc_reference. Hiện STUB như police-report.
--
-- RLS tenant-scoped (CRUD qua withTenant). Composite FK (tenant,booking)/(tenant,guest)
-- chuẩn chung (ADR-0005). Retention: hồ sơ tạm trú NN — giữ DÀI HẠN theo luật cư trú
-- (như police-report, docs/03 §7); KHÔNG night-audit xoá.
-- ============================================================================

CREATE TABLE foreign_residence_declarations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  property_id UUID NOT NULL,            -- denormalize từ booking (cố định) → filter/authorize
  booking_id UUID NOT NULL,             -- stay phát sinh nghĩa vụ khai báo
  guest_id UUID NOT NULL,               -- khách NN (guest chính của booking; PII ở guests)

  -- NA17 — dữ liệu per-stay khách nước ngoài
  visa_number_enc BYTEA,                -- số thị thực mã hoá field (ADR-0007); NULL nếu miễn thị thực
  visa_number_last4 VARCHAR(4),         -- 4 ký tự cuối hiển thị (masked)
  visa_type VARCHAR(32),                -- mã loại thị thực (DL/DN/LĐ/ĐT…) hoặc 'EXEMPT'
  visa_expiry DATE,                     -- ngày hết hạn thị thực/tạm trú
  date_of_entry DATE,                   -- ngày nhập cảnh VN
  port_of_entry VARCHAR(255),           -- cửa khẩu nhập cảnh
  intended_departure DATE,              -- ngày dự kiến rời đi

  -- Vòng đời khai báo
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'SUBMITTED', 'FAILED')),
  submitted_at TIMESTAMPTZ,
  submitted_by UUID,                    -- user đã bấm "Gửi" (không FK, như booking_surcharges.created_by)
  xnc_reference VARCHAR(255),           -- mã tiếp nhận từ XNC (Phase 2)
  failure_reason TEXT,                  -- lý do FAILED (thiếu trường nào)

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, id),               -- target composite FK chuẩn chung
  UNIQUE (tenant_id, booking_id),       -- 1 khai báo / booking (guest chính)
  FOREIGN KEY (tenant_id, booking_id) REFERENCES bookings (tenant_id, id),
  FOREIGN KEY (tenant_id, guest_id) REFERENCES guests (tenant_id, id)
);

CREATE INDEX idx_foreign_residence_property
  ON foreign_residence_declarations (tenant_id, property_id);

CREATE TRIGGER foreign_residence_declarations_set_updated_at
  BEFORE UPDATE ON foreign_residence_declarations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enforce_tenant_isolation('foreign_residence_declarations');
