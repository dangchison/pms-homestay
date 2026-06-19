#!/usr/bin/env bash
#
# Restore drill (docs/11 §6 — BẮT BUỘC theo quý): tải backup mới nhất từ R2 →
# restore vào DB NHÁP → sanity check → đo RTO/RPO thực tế. Ghi kết quả vào bảng
# drill trong docs/17 §1.
#
# Env bắt buộc:
#   R2_ENDPOINT R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
#   DRILL_DATABASE_URL  (DB NHÁP — sẽ bị --clean ghi đè; ⚠️ TUYỆT ĐỐI không trỏ prod)
# Env tuỳ chọn:
#   BACKUP_KEY (mặc định: object mới nhất trong daily/) · R2_REGION (mặc định "auto")
# Yêu cầu host: aws CLI + pg_restore + psql (postgresql-client 16).
set -euo pipefail

fail() {
  echo "❌ $*" >&2
  exit 1
}

: "${R2_ENDPOINT:?cần R2_ENDPOINT}"
: "${R2_BUCKET:?cần R2_BUCKET}"
: "${R2_ACCESS_KEY_ID:?cần R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?cần R2_SECRET_ACCESS_KEY}"
: "${DRILL_DATABASE_URL:?cần DRILL_DATABASE_URL (DB nháp, KHÔNG phải prod)}"

command -v aws >/dev/null 2>&1 || fail "thiếu aws CLI"
command -v pg_restore >/dev/null 2>&1 || fail "thiếu pg_restore"
command -v psql >/dev/null 2>&1 || fail "thiếu psql"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${R2_REGION:-auto}"

# 1) Chọn backup: BACKUP_KEY chỉ định, hoặc object mới nhất trong daily/.
key="${BACKUP_KEY:-}"
if [ -z "$key" ]; then
  latest="$(aws s3 ls "s3://$R2_BUCKET/daily/" --endpoint-url "$R2_ENDPOINT" | sort | tail -1 | awk '{print $4}')"
  [ -n "$latest" ] || fail "không có backup nào trong s3://$R2_BUCKET/daily/"
  key="daily/$latest"
fi
base="$(basename "$key")"
echo "▶ backup: $key"

# 2) RPO = tuổi backup (parse timestamp từ tên pms-YYYYmmddTHHMMSSZ.dump; best-effort).
rpo="n/a"
stamp="${base#pms-}"
stamp="${stamp%.dump}"
if [ "${#stamp}" -ge 15 ]; then
  iso="${stamp:0:4}-${stamp:4:2}-${stamp:6:2} ${stamp:9:2}:${stamp:11:2}:${stamp:13:2}"
  if backup_epoch="$(date -u -d "$iso" +%s 2>/dev/null)"; then
    age=$(( $(date -u +%s) - backup_epoch ))
    rpo="$(( age / 3600 ))h $(( (age % 3600) / 60 ))m"
  fi
fi

# 3) Tải về + restore vào DB nháp, đo RTO.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "▶ tải về s3://$R2_BUCKET/$key"
aws s3 cp "s3://$R2_BUCKET/$key" "$tmp/$base" --endpoint-url "$R2_ENDPOINT"

echo "▶ restore vào DB nháp (--clean --no-owner)"
start="$(date +%s)"
# --no-owner/--no-privileges: DB nháp có thể không có role app_user/postgres của prod.
# --clean --if-exists: idempotent khi chạy lại trên cùng DB nháp (lần đầu sẽ có
# notice "không tồn tại, bỏ qua" — bình thường).
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname="$DRILL_DATABASE_URL" "$tmp/$base" \
  || echo "⚠ pg_restore trả cảnh báo (kiểm tra sanity bên dưới để kết luận)"
rto=$(( $(date +%s) - start ))

# 4) Sanity check — ON_ERROR_STOP: bảng thiếu = restore hỏng → drill FAIL.
echo "▶ sanity check"
psql "$DRILL_DATABASE_URL" -v ON_ERROR_STOP=1 -At <<'SQL'
select 'tenants    = ' || count(*) from tenants;
select 'properties = ' || count(*) from properties;
select 'bookings   = ' || count(*) from bookings;
select 'migrations = ' || count(*) from pgmigrations;
SQL

# 5) Report — ghi vào docs/17 §1 (bảng drill).
echo "──────────── DRILL REPORT ────────────"
echo "  backup_key : $key"
echo "  RPO (tuổi) : $rpo"
echo "  RTO (giây) : $rto"
echo "  → Ghi RTO/RPO + ngày drill vào docs/17 §1."
echo "──────────────────────────────────────"
