-- Up Migration
-- ============================================================================
-- 0016 — Rollup thống kê ngày theo cơ sở (task 4.6)
-- DDL docs/03 §daily_property_stats. Night-audit fill mỗi đêm cho NGÀY VỪA QUA;
-- report P&L/break-even (3.7) đọc bảng này cho quá khứ + tính live phần hôm nay
-- (docs/09 §8) — KHÔNG SUM real-time cả kỳ.
--
-- PK (tenant_id, property_id, stat_date) → upsert idempotent (chạy lại đêm ghi đè).
-- Retention (docs/03 §7): số liệu tổng hợp, giữ dài hạn.
-- ============================================================================

CREATE TABLE daily_property_stats (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  property_id UUID NOT NULL,
  stat_date DATE NOT NULL,
  available_room_nights INT NOT NULL DEFAULT 0,   -- số phòng active × 1 đêm
  occupied_room_nights INT NOT NULL DEFAULT 0,    -- room_occupancy phủ ngày này
  room_revenue_vnd BIGINT NOT NULL DEFAULT 0,     -- doanh thu phòng phân bổ /đêm
  other_revenue_vnd BIGINT NOT NULL DEFAULT 0,
  adr_vnd BIGINT,                                 -- room_revenue / occupied_room_nights
  revpar_vnd BIGINT,                              -- room_revenue / available_room_nights
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, property_id, stat_date),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id)
);

SELECT enforce_tenant_isolation('daily_property_stats');
