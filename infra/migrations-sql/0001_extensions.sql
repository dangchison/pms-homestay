-- Up Migration
-- ============================================================================
-- 0001 — Extensions + helper functions (docs/03, ADR-0001)
-- Retention: n/a (hạ tầng schema)
-- Lưu ý: KHÔNG dùng uuid-ossp — gen_random_uuid() native từ PG13 (docs/01 §DB)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist; -- EXCLUDE constraint cho room_occupancy (ADR-0006)
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- search tên khách/phòng
CREATE EXTENSION IF NOT EXISTS citext;     -- email case-insensitive
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- digest()/hmac() phục vụ blind index khi cần ở DB

-- ----------------------------------------------------------------------------
-- Trigger function: tự cập nhật updated_at
-- Dùng: CREATE TRIGGER <t>_set_updated_at BEFORE UPDATE ON <t>
--         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- enforce_tenant_isolation(table_name): áp RLS template chuẩn cho bảng
-- tenant-scoped (docs/02 §RLS). MỌI bảng có tenant_id BẮT BUỘC gọi hàm này
-- trong migration tạo bảng.
--   - FORCE RLS: owner cũng chịu policy (superuser vẫn bypass → app chạy app_user)
--   - NULLIF(..., ''): GUC chưa set → policy trả NULL (chặn hết) thay vì lỗi 22P02
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_tenant_isolation(table_name text) RETURNS void AS $$
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid)',
    table_name
  );
  EXECUTE format(
    'CREATE POLICY tenant_isolation_insert ON %I FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid)',
    table_name
  );
END;
$$ LANGUAGE plpgsql;
