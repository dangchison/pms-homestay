-- Up Migration
-- ============================================================================
-- 0026 — Quản lý vòng đời partition audit_logs (task 8.5)
-- Retention: function hạ tầng (không bảng mới)
--
-- 0020 pre-create partition tháng 2026-01..2027-12 + audit_logs_default. Cửa sổ đó
-- cạn dần → cần TỰ tạo partition tháng kế (night-audit gọi hằng ngày) và DETACH
-- partition quá hạn lưu (>12 tháng) để archive (dump S3 — runbook 8.6), giữ bảng
-- cha gọn. App runtime = app_user KHÔNG sở hữu audit_logs nên không có quyền DDL →
-- 3 hàm dưới đây SECURITY DEFINER (owner = postgres, như resolve_ical_token 0024)
-- để chạy CREATE/DETACH/RENAME với quyền owner khi app_user EXECUTE.
--
-- An toàn:
--   - Chỉ thao tác đối tượng tên `audit_logs_YYYY_MM` (regex chặt) — không đụng
--     bảng khác; bỏ qua audit_logs_default và audit_logs_archived_*.
--   - SET search_path cố định (chống chiếm dụng tên — best practice DEFINER).
--   - Tạo partition tháng TƯƠNG LAI khi default còn rỗng trong khoảng đó → không
--     vướng ràng buộc "default chứa dòng thuộc range mới" (night-audit tạo sớm).
--   - EXECUTE mặc định cho PUBLIC (app_user ∈ PUBLIC) — không GRANT tên role.
-- ============================================================================

-- (1) Đảm bảo có partition cho [tháng hiện tại .. +p_months_ahead]. Idempotent.
--     Trả số partition vừa tạo.
CREATE OR REPLACE FUNCTION ensure_audit_partitions(p_months_ahead int DEFAULT 3)
  RETURNS int
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  m date := date_trunc('month', now())::date;
  stop date := (date_trunc('month', now()) + make_interval(months => p_months_ahead))::date;
  part_name text;
  created int := 0;
BEGIN
  WHILE m <= stop LOOP
    part_name := 'audit_logs_' || to_char(m, 'YYYY_MM');
    IF to_regclass(part_name) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
        part_name, m, (m + interval '1 month')::date
      );
      created := created + 1;
    END IF;
    m := (m + interval '1 month')::date;
  END LOOP;
  RETURN created;
END $$;

-- (2) DETACH partition cũ hơn p_keep_months (so tháng hiện tại) rồi đổi tên
--     audit_logs_archived_YYYY_MM (đứng độc lập — dump S3 sau, KHÔNG drop ở đây).
--     Trả mảng tên đã archive.
CREATE OR REPLACE FUNCTION detach_old_audit_partitions(p_keep_months int DEFAULT 12)
  RETURNS text[]
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  cutoff date := (date_trunc('month', now()) - make_interval(months => p_keep_months))::date;
  rec record;
  archived text[] := '{}';
  new_name text;
  part_month date;
BEGIN
  FOR rec IN
    SELECT c.relname AS part_name
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'audit_logs'
      AND c.relname ~ '^audit_logs_[0-9]{4}_[0-9]{2}$'
  LOOP
    part_month := to_date(right(rec.part_name, 7), 'YYYY_MM');
    IF part_month < cutoff THEN
      EXECUTE format('ALTER TABLE audit_logs DETACH PARTITION %I', rec.part_name);
      new_name := 'audit_logs_archived_' || to_char(part_month, 'YYYY_MM');
      EXECUTE format('ALTER TABLE %I RENAME TO %I', rec.part_name, new_name);
      archived := array_append(archived, new_name);
    END IF;
  END LOOP;
  RETURN archived;
END $$;

-- (3) Health-check: trả mảng tháng (YYYY_MM) trong [hiện tại .. +p_months_ahead]
--     CHƯA có partition → night-audit cảnh báo nếu không rỗng (alert docs/11 §9).
CREATE OR REPLACE FUNCTION audit_partitions_missing(p_months_ahead int DEFAULT 1)
  RETURNS text[]
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  m date := date_trunc('month', now())::date;
  stop date := (date_trunc('month', now()) + make_interval(months => p_months_ahead))::date;
  missing text[] := '{}';
BEGIN
  WHILE m <= stop LOOP
    IF to_regclass('audit_logs_' || to_char(m, 'YYYY_MM')) IS NULL THEN
      missing := array_append(missing, to_char(m, 'YYYY_MM'));
    END IF;
    m := (m + interval '1 month')::date;
  END LOOP;
  RETURN missing;
END $$;

COMMENT ON FUNCTION ensure_audit_partitions(int) IS
  'Task 8.5: tạo partition audit_logs tháng [hiện tại..+N] nếu thiếu (idempotent). SECURITY DEFINER.';
COMMENT ON FUNCTION detach_old_audit_partitions(int) IS
  'Task 8.5: detach partition audit_logs cũ >N tháng → audit_logs_archived_YYYY_MM (archive). SECURITY DEFINER.';
COMMENT ON FUNCTION audit_partitions_missing(int) IS
  'Task 8.5: liệt kê tháng [hiện tại..+N] thiếu partition (health-check/alert). SECURITY DEFINER.';

-- Down Migration
DROP FUNCTION IF EXISTS audit_partitions_missing(int);
DROP FUNCTION IF EXISTS detach_old_audit_partitions(int);
DROP FUNCTION IF EXISTS ensure_audit_partitions(int);
