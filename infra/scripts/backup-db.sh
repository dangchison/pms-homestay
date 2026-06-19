#!/usr/bin/env bash
#
# Backup logic hằng ngày: pg_dump (custom format) → Cloudflare R2 (docs/11 §6).
#
# Chạy bằng HOST cron 02:00 ICT (KHÔNG phải GitHub Actions — runner không vào được
# DB prod private). `pg_dump` là LOGICAL backup, KHÔNG phải PITR: PITR đến từ WAL
# archiving (provider managed-PG, hoặc pgBackRest tự host) — đừng nhầm hai thứ
# (docs/11 §6). Script này = lớp logical-dump độc lập, ta tự giữ trên R2.
#
# Retention: dùng R2 bucket **lifecycle policy** (prefix `daily/` 30 ngày, `weekly/`
# 12 tuần) — script CỐ Ý KHÔNG tự xoá object (tránh lỡ tay mất backup). Xem docs/17 §1.
#
# Env bắt buộc:
#   R2_ENDPOINT R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
#   BACKUP_DATABASE_URL  (mặc định = DATABASE_URL_MIGRATIONS — cần quyền đọc TOÀN DB)
# Env tuỳ chọn:
#   R2_REGION (mặc định "auto") · R2_BUCKET_DR + R2_ENDPOINT_DR (copy weekly cross-region, chạy CN)
# Yêu cầu host: pg_dump (postgresql-client 16) + aws CLI.
set -euo pipefail

fail() {
  echo "❌ $*" >&2
  exit 1
}

: "${R2_ENDPOINT:?cần R2_ENDPOINT}"
: "${R2_BUCKET:?cần R2_BUCKET}"
: "${R2_ACCESS_KEY_ID:?cần R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?cần R2_SECRET_ACCESS_KEY}"
BACKUP_DATABASE_URL="${BACKUP_DATABASE_URL:-${DATABASE_URL_MIGRATIONS:-}}"
[ -n "$BACKUP_DATABASE_URL" ] || fail "cần BACKUP_DATABASE_URL hoặc DATABASE_URL_MIGRATIONS"

command -v pg_dump >/dev/null 2>&1 || fail "thiếu pg_dump (cài postgresql-client-16)"
command -v aws >/dev/null 2>&1 || fail "thiếu aws CLI (cài awscli)"

# aws CLI đọc creds từ các biến chuẩn; map từ R2_* để không lẫn với S3 ứng dụng.
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${R2_REGION:-auto}"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
file="pms-${ts}.dump"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "▶ pg_dump (custom format) → $file"
# Dump trung thực (giữ owner/grant) để DR restore vào cluster tương đương; drill
# restore bằng --no-owner cho DB nháp (xem restore-drill.sh).
pg_dump --format=custom --compress=6 --file="$tmp/$file" "$BACKUP_DATABASE_URL"
size="$(du -h "$tmp/$file" | cut -f1)"

echo "▶ upload → s3://$R2_BUCKET/daily/$file ($size)"
aws s3 cp "$tmp/$file" "s3://$R2_BUCKET/daily/$file" --endpoint-url "$R2_ENDPOINT"

# Cross-region weekly: Chủ nhật (ISO weekday 7) → copy sang bucket DR khác vùng.
if [ "$(date -u +%u)" = "7" ] && [ -n "${R2_BUCKET_DR:-}" ]; then
  echo "▶ weekly cross-region → s3://$R2_BUCKET_DR/weekly/$file"
  aws s3 cp "$tmp/$file" "s3://$R2_BUCKET_DR/weekly/$file" \
    --endpoint-url "${R2_ENDPOINT_DR:-$R2_ENDPOINT}"
fi

echo "✔ backup xong: daily/$file ($size)"
