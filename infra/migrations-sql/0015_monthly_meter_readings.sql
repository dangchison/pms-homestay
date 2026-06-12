-- Up Migration
-- ============================================================================
-- 0015 — Chỉ số điện/nước cho thuê tháng (task 3.8)
-- DDL docs/03 §4 (monthly_meter_readings). Staff ghi chỉ số đầu/cuối kỳ; job
-- billing-cycle (night-audit 4.6, ngày 1) đọc bảng này sinh invoice MONTHLY_RENT
-- (tiền nhà pro-rate /30 + điện nước = (end−start) × đơn giá plan) — docs/09 §4.5.
--
-- UNIQUE (booking, kỳ) → mỗi booking 1 chỉ số/tháng (upsert khi staff sửa).
-- Retention (docs/03 §7): gắn booking — theo vòng đời booking.
-- ============================================================================

CREATE TABLE monthly_meter_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  booking_id UUID NOT NULL,
  period_year SMALLINT NOT NULL,
  period_month SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  electricity_kwh_start NUMERIC(10,1),
  electricity_kwh_end NUMERIC(10,1),
  water_m3_start NUMERIC(10,1),
  water_m3_end NUMERIC(10,1),
  recorded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (booking_id, period_year, period_month),
  FOREIGN KEY (tenant_id, booking_id) REFERENCES bookings (tenant_id, id)
);

CREATE INDEX idx_meter_readings_booking ON monthly_meter_readings (tenant_id, booking_id);

SELECT enforce_tenant_isolation('monthly_meter_readings');
