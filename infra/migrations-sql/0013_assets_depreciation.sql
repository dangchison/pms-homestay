-- Up Migration
-- ============================================================================
-- 0013 — Tài sản & khấu hao (task 3.5)
-- DDL docs/03 §4.7, thuật toán docs/09 §7. assets: soft-delete (deleted_at);
-- depreciation_entries: sổ khấu hao bất biến (append-only, KHÔNG updated_at/
-- deleted_at) — mỗi (asset, kỳ) đúng 1 dòng (UNIQUE) → cron chạy lại idempotent
-- nhờ createMany skipDuplicates.
--
-- Retention (docs/03 §7): chứng từ tài chính giữ theo luật kế toán VN (10 năm) —
--   KHÔNG xoá depreciation_entries; asset thanh lý vẫn lưu (disposal_date) để P&L
--   truy vết. Soft-delete asset chỉ ẩn khỏi danh sách vận hành.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- assets — tài sản cố định gắn cơ sở (room_id NULL = khu vực chung)
-- ----------------------------------------------------------------------------
CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  property_id UUID NOT NULL,
  room_id UUID,                                   -- NULL = khu vực chung (sảnh, bếp,...)
  name VARCHAR(255) NOT NULL,
  category VARCHAR(64),                           -- FURNITURE, ELECTRONICS, APPLIANCE,...
  serial_number VARCHAR(100),
  purchase_value_vnd BIGINT NOT NULL CHECK (purchase_value_vnd >= 0),  -- nguyên giá
  purchase_date DATE NOT NULL,
  depreciation_method VARCHAR(32) NOT NULL DEFAULT 'STRAIGHT_LINE',
  depreciation_months INT NOT NULL CHECK (depreciation_months > 0),
  residual_value_vnd BIGINT NOT NULL DEFAULT 0
    CHECK (residual_value_vnd >= 0 AND residual_value_vnd <= purchase_value_vnd),  -- giá trị còn lại ≤ nguyên giá
  disposal_date DATE,
  disposal_value_vnd BIGINT CHECK (disposal_value_vnd IS NULL OR disposal_value_vnd >= 0),
  notes TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),                          -- đích cho composite FK của depreciation_entries
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES rooms (tenant_id, id)  -- room_id NULL → FK không enforce (MATCH SIMPLE)
);

CREATE INDEX idx_assets_property ON assets (tenant_id, property_id);
-- Truy vấn cron khấu hao: lọc theo purchase_date/disposal_date trong 1 tenant.
CREATE INDEX idx_assets_active ON assets (tenant_id, purchase_date) WHERE disposal_date IS NULL;

CREATE TRIGGER assets_set_updated_at
  BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enforce_tenant_isolation('assets');

-- ----------------------------------------------------------------------------
-- depreciation_entries — sổ khấu hao theo kỳ (tháng). Append-only.
-- Tháng cuối = plug số dư (docs/09 §7): accumulated cuối == nguyên giá − residual.
-- ----------------------------------------------------------------------------
CREATE TABLE depreciation_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  asset_id UUID NOT NULL,
  period_year SMALLINT NOT NULL,
  period_month SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  amount_vnd BIGINT NOT NULL,                      -- khấu hao kỳ này
  accumulated_vnd BIGINT NOT NULL,                 -- luỹ kế tới hết kỳ
  book_value_vnd BIGINT NOT NULL,                  -- giá trị còn lại = nguyên giá − accumulated
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, period_year, period_month),    -- 1 dòng / (asset, kỳ) → skipDuplicates idempotent
  FOREIGN KEY (tenant_id, asset_id) REFERENCES assets (tenant_id, id)
);

-- GROUP BY asset_id (accumulatedByAsset — chống N+1 trong cron).
CREATE INDEX idx_depreciation_entries_asset ON depreciation_entries (tenant_id, asset_id);

SELECT enforce_tenant_isolation('depreciation_entries');
