-- Up Migration
-- ============================================================================
-- 0024 — resolve_ical_token: tra cứu cross-tenant cho endpoint push iCal (task 5.3)
-- Retention: n/a (function hạ tầng)
--
-- Endpoint công khai `GET /api/v1/public/sync/ical/:token` chạy NGOÀI ngữ cảnh
-- tenant: không JWT, không set GUC `app.current_tenant_id`. App kết nối bằng role
-- `app_user` (FORCE ROW LEVEL SECURITY) nên policy `tenant_isolation` so tenant_id
-- với GUC = NULL → channel_resource_mappings trả 0 dòng. Không thể tra token được.
--
-- Giải pháp: hàm SECURITY DEFINER này thuộc sở hữu của owner migration (postgres,
-- superuser) → khi app_user GỌI hàm, thân hàm chạy với quyền postgres và superuser
-- bypass cả FORCE RLS, nên đọc được mapping của MỌI tenant. Trả về tenant_id để
-- service mở `withTenant(tenant_id)` đọc occupancy bình thường (RLS lại áp đủ).
--
-- An toàn:
--   - Đầu vào là token bí mật 24-byte (48 hex) — biết token mới resolve được.
--   - Chỉ trả mapping + channel CÒN active (huỷ kênh/mapping = thu hồi feed).
--   - STABLE + chỉ SELECT (không ghi); SET search_path cố định chống chiếm dụng
--     tên object (best practice SECURITY DEFINER).
--   - EXECUTE để mặc định cho PUBLIC (app_user ∈ PUBLIC) — KHÔNG GRANT tường minh
--     để migration không tham chiếu tên role runtime (đồng nhất các bảng khác).
-- ============================================================================

CREATE OR REPLACE FUNCTION resolve_ical_token(p_token text)
  RETURNS TABLE (tenant_id uuid, resource_id uuid, property_id uuid, channel_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT m.tenant_id, m.resource_id, c.property_id, c.id
  FROM channel_resource_mappings m
  JOIN channels c ON c.tenant_id = m.tenant_id AND c.id = m.channel_id
  WHERE m.ical_push_token = p_token
    AND m.is_active
    AND c.is_active
  LIMIT 1;
$$;

COMMENT ON FUNCTION resolve_ical_token(text) IS
  'Task 5.3: tra ical_push_token → (tenant_id, resource_id, property_id, channel_id) '
  'cross-tenant cho endpoint push iCal công khai. SECURITY DEFINER (postgres) bypass '
  'FORCE RLS trên channel_resource_mappings/channels. Chỉ trả mapping+channel active.';
