-- Up Migration
-- ============================================================================
-- 0014 — Chi phí vận hành + hoa hồng OTA (task 3.6)
-- DDL docs/03 §4.7, docs/09 §6. operational_expenses: chi phí thủ công + định kỳ
-- (template is_recurring → night-audit sinh child theo kỳ) + OTA_COMMISSION
-- auto-sinh khi booking CHECKED_OUT.
--
-- ★ Hoa hồng OTA chỉ MỘT đường ghi (docs/09 §6): partial unique
--   uq_expense_ota_commission đảm bảo mỗi booking sinh đúng 1 dòng; P&L đọc chi
--   phí hoa hồng DUY NHẤT từ bảng này (không cộng bookings.commission_vnd lần nữa).
--
-- Composite FK (tenant_id, x) theo ADR-0005 (kể cả parent_expense_id tự tham
-- chiếu). Không soft-delete (chứng từ chi phí — sửa/xoá có kiểm soát ở service).
-- Retention (docs/03 §7): chứng từ tài chính giữ theo luật kế toán VN (10 năm).
-- ============================================================================

CREATE TABLE operational_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  property_id UUID NOT NULL,
  room_id UUID,                                  -- NULL = chi phí cấp cơ sở
  expense_type VARCHAR(32) NOT NULL CHECK (expense_type IN
    ('RENT_LANDLORD','ELECTRICITY','WATER','INTERNET','GAS','AMENITIES','CLEANING_SUPPLIES',
     'STAFF_SALARY','MAINTENANCE','MARKETING','OTA_COMMISSION','PLATFORM_FEE','TAX','OTHER')),
  description VARCHAR(500),
  amount_vnd BIGINT NOT NULL CHECK (amount_vnd >= 0),
  expense_date DATE NOT NULL,
  due_date DATE,
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  recurrence_pattern VARCHAR(32)
    CHECK (recurrence_pattern IS NULL OR recurrence_pattern IN ('MONTHLY','QUARTERLY','YEARLY')),
  parent_expense_id UUID,                        -- child định kỳ → template gốc
  source_booking_id UUID,                        -- OTA_COMMISSION auto-sinh khi CHECKED_OUT
  is_paid BOOLEAN NOT NULL DEFAULT false,
  paid_at TIMESTAMPTZ,
  receipt_url TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- template định kỳ phải có pattern (toàn vẹn dữ liệu cho cron sinh child)
  CHECK (NOT is_recurring OR recurrence_pattern IS NOT NULL),
  UNIQUE (tenant_id, id),                        -- đích cho composite self-FK parent
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES rooms (tenant_id, id),
  FOREIGN KEY (tenant_id, source_booking_id) REFERENCES bookings (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_expense_id) REFERENCES operational_expenses (tenant_id, id)
);

-- ★ Mỗi booking chỉ sinh 1 dòng OTA_COMMISSION (idempotent createMany skipDuplicates).
CREATE UNIQUE INDEX uq_expense_ota_commission ON operational_expenses (source_booking_id)
  WHERE expense_type = 'OTA_COMMISSION';

CREATE INDEX idx_op_expenses_property_date ON operational_expenses (tenant_id, property_id, expense_date);
-- Tìm template định kỳ (cron sinh child) — bảng nhỏ, partial index gọn.
CREATE INDEX idx_op_expenses_recurring ON operational_expenses (tenant_id, expense_date)
  WHERE is_recurring;

CREATE TRIGGER operational_expenses_set_updated_at
  BEFORE UPDATE ON operational_expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enforce_tenant_isolation('operational_expenses');
