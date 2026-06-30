-- Up Migration
-- ============================================================================
-- 0030 — Tầng danh tính khách TOÀN CỤC (Global Person Identity) — Phase 3 (docs/16)
-- Retention: n/a (bảng danh tính pseudonymous, không PII)
--
-- VẤN ĐỀ: guests cô lập tuyệt đối theo tenant (FORCE RLS) → cùng 1 người ở chủ A
-- rồi chủ B (2 tenant) bị coi là 2 khách khác nhau, không liên kết.
--
-- GIẢI PHÁP: bảng GLOBAL `persons` (KHÔNG tenant_id, KHÔNG RLS) làm danh tính 1 con
-- người thật, khoá theo `national_id_hash` = CHÍNH giá trị `guests.id_document_number_hash`
-- (HMAC-SHA256 khoá toàn cục PII_HMAC_KEY → cùng 1 số giấy tờ cho cùng hash ở MỌI
-- tenant). Mỗi `guests` trỏ `person_id` → persons. Nhờ vậy nhận diện "cùng người"
-- xuyên-tenant VÀ trong-tenant.
--
-- RIÊNG TƯ (NĐ13): persons CHỈ chứa hash + counters phi-PII (không tên/số/lịch sử)
-- → KHÔNG phải dữ liệu cá nhân. PII guests GIỮ NGUYÊN cô lập RLS theo tenant. Tầng
-- này chỉ "nhận diện", KHÔNG chia sẻ PII cross-tenant (chủ B không thấy dữ liệu chủ A).
--
-- FK `guests.person_id` là FK ĐƠN (persons không có tenant_id → khác composite FK
-- (tenant_id, x) của các bảng tenant-scoped). persons KHÔNG gọi enforce_tenant_isolation.
-- ============================================================================

CREATE TABLE persons (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  national_id_hash     BYTEA       NOT NULL UNIQUE,
  tenant_link_count    INTEGER     NOT NULL DEFAULT 0,
  blacklisted_anywhere BOOLEAN     NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE persons IS
  'Danh tính khách TOÀN CỤC (Phase 3, docs/16). GLOBAL — không tenant_id, không RLS. '
  'Chỉ chứa hash + counters phi-PII (pseudonymous, không phải PII theo NĐ13). Nhận diện '
  'cùng 1 người xuyên-tenant; KHÔNG chia sẻ PII cross-tenant.';
COMMENT ON COLUMN persons.national_id_hash IS
  '= guests.id_document_number_hash (HMAC-SHA256 khoá toàn cục PII_HMAC_KEY). Cùng số '
  'giấy tờ ⇒ cùng hash ở mọi tenant → khoá nhận diện cùng người.';
COMMENT ON COLUMN persons.tenant_link_count IS
  'Số tenant DISTINCT đang có guest (chưa xoá/ẩn danh) link tới person. ≥2 ⇒ khách quen toàn nền tảng.';
COMMENT ON COLUMN persons.blacklisted_anywhere IS
  'Có ≥1 guest is_blacklisted (chưa xoá) link tới person ở BẤT KỲ tenant nào.';

CREATE TRIGGER persons_set_updated_at
  BEFORE UPDATE ON persons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Link guests → persons (FK đơn; nullable: walk-in/OTA chưa có giấy tờ → NULL, link sau).
ALTER TABLE guests ADD COLUMN person_id UUID REFERENCES persons(id);
CREATE INDEX idx_guests_person ON guests (person_id);
COMMENT ON COLUMN guests.person_id IS
  'Danh tính toàn cục (persons.id). NULL khi guest chưa có số giấy tờ. Set/đổi khi '
  'id_document_number được ghi/đổi qua GuestsService.';

-- Đồng bộ counters phi-PII của persons từ guests cross-tenant. SECURITY DEFINER
-- (sở hữu postgres) bypass FORCE RLS để ĐẾM (chỉ ghi counter phi-PII; KHÔNG trả PII).
-- Khuôn mẫu: resolve_ical_token (0024). Gọi sau mỗi guest-write (create/update/
-- blacklist/remove/erasure) cho person liên quan.
CREATE OR REPLACE FUNCTION recompute_person_counters(p_person_id uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  UPDATE persons p SET
    tenant_link_count = (
      SELECT COUNT(DISTINCT g.tenant_id)
      FROM guests g
      WHERE g.person_id = p.id AND g.deleted_at IS NULL AND g.anonymized_at IS NULL
    ),
    blacklisted_anywhere = EXISTS (
      SELECT 1 FROM guests g
      WHERE g.person_id = p.id AND g.is_blacklisted AND g.deleted_at IS NULL
    ),
    updated_at = now()
  WHERE p.id = p_person_id;
$$;

COMMENT ON FUNCTION recompute_person_counters(uuid) IS
  'Phase 3: recompute persons.tenant_link_count + blacklisted_anywhere từ guests '
  'cross-tenant. SECURITY DEFINER (postgres) bypass FORCE RLS — chỉ ĐẾM + ghi counter '
  'phi-PII, KHÔNG trả/ghi PII. Gọi sau mỗi guest-write cho person liên quan.';
