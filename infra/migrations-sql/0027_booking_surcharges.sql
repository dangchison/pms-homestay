-- Up Migration
-- ============================================================================
-- 0027 — STAY phụ thu (P2-B B5, docs/09 §4.3)
-- booking_surcharges: phụ thu phát sinh TRONG lúc lưu trú (minibar/dịch vụ/điện
-- nước) ghi nhận trên BOOKING. Khi check-out, issueStayForBooking gộp các dòng này
-- thành invoice_items (SURCHARGE/AMENITY/UTILITY) vào STAY invoice → total/balance
-- phản ánh đúng. Mirror kiểu cột của invoice_items (quantity NUMERIC, *_vnd BIGINT).
-- RLS tenant-scoped (CRUD qua withTenant). Composite FK (tenant,booking) chuẩn chung.
-- Retention: theo booking — VĨNH VIỄN (nghĩa vụ kế toán, như finance docs/03 §7).
-- ============================================================================

CREATE TABLE booking_surcharges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  booking_id UUID NOT NULL,
  item_type VARCHAR(32) NOT NULL
    CHECK (item_type IN ('SURCHARGE', 'AMENITY', 'UTILITY')),
  description VARCHAR(500) NOT NULL,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  unit_price_vnd BIGINT NOT NULL,
  amount_vnd BIGINT NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, booking_id) REFERENCES bookings (tenant_id, id)
);

CREATE INDEX idx_booking_surcharges_booking ON booking_surcharges (tenant_id, booking_id);

SELECT enforce_tenant_isolation('booking_surcharges');
