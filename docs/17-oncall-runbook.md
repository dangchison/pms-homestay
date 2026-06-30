# 17 — ON-CALL RUNBOOK

Hướng dẫn xử lý sự cố **theo từng kịch bản** cho người trực vận hành. Đây là tài
liệu **thao tác** (làm gì, gõ lệnh gì) — phần **thiết kế/chính sách** (backup,
Sentry, alert rules, retention) nằm ở [`11-observability-ops.md`](11-observability-ops.md).

> **Quy ước kết nối DB.** Thao tác thường (đọc trạng thái) dùng `DATABASE_URL`
> (`app_user`, chịu RLS → phải set tenant GUC để thấy dữ liệu tenant). Thao tác
> quản trị (reset job, DDL partition, sửa cross-tenant) dùng
> `DATABASE_URL_MIGRATIONS` (`postgres` superuser, bypass RLS). Ví dụ:
> `psql "$DATABASE_URL_MIGRATIONS"`.
>
> Để thấy dữ liệu **một tenant** qua `app_user`:
> ```sql
> SET app.current_tenant_id = '<tenant_uuid>';
> -- ... query bảng có RLS ...
> ```

Phân loại mức độ: 🔴 mất dịch vụ / mất tiền · 🟠 lệch dữ liệu · 🟡 theo dõi.

---

## 0. Kiểm tra sức khỏe nhanh

```bash
curl -fsS localhost:3001/health/liveness    # process sống
curl -fsS localhost:3001/health/readiness   # PG + Redis OK → {"status":"ok"}
curl -fsS localhost:3001/health/startup      # đã migrate + boot xong
```

- `readiness` đỏ → kiểm tra Postgres/Redis trước tiên (xem §6).
- App **crash ngay khi boot** kèm `❌ Env không hợp lệ` → thiếu/sai biến môi
  trường (zod fail-fast, [`11` §env]). Đọc dòng lỗi → bổ sung biến → khởi động
  lại. KHÔNG vá bằng cách bỏ validate.

Scheduler/worker (outbox dispatcher, night-audit, đối soát, iCal pull,
notification) **chỉ chạy khi `ENABLE_SCHEDULERS=true`**. Nếu các job "không tự
chạy", kiểm tra biến này TRƯỚC.

---

## 1. 🔴 Khôi phục dữ liệu (restore)

Chính sách backup + mục tiêu RTO/RPO: [`11` §6](11-observability-ops.md) và các
kịch bản DR ở [`11` §12]. Quy trình thao tác:

1. **Xác định phạm vi.** Mất toàn bộ DB hay chỉ hỏng/xoá nhầm dữ liệu một tenant?
   - Toàn bộ → restore từ PITR/snapshot provider (hoặc logical dump gần nhất).
   - Một tenant → ưu tiên sửa có chủ đích thay vì restore toàn cục (xem §3/§4);
     chỉ restore một phần khi không còn cách khác.
2. **Khôi phục.** Theo phương án hosting đã chốt ([`11` §6]):
   - **PITR** (mất tới thời điểm gần nhất): của provider managed-PG, hoặc
     pgBackRest WAL (self-host). `pg_dump` KHÔNG làm được PITR.
   - **Logical dump trên R2** (lớp độc lập ta tự giữ): tải `.dump` mới nhất rồi
     `pg_restore` vào DB tạm:
     ```bash
     aws s3 cp s3://$R2_BUCKET/daily/<file>.dump . --endpoint-url "$R2_ENDPOINT"
     pg_restore --clean --if-exists -d "$TARGET_DATABASE_URL" <file>.dump
     ```
     (Restore vào DB tạm, xác minh, rồi mới cắt traffic.)
3. **Migrate về đúng schema.** Sau restore:
   ```bash
   pnpm --filter @pms/api db:migrate:sql   # áp migration còn thiếu (idempotent)
   ```
4. **Xác minh.**
   ```bash
   psql "$DATABASE_URL_MIGRATIONS" -c "select count(*) from tenants;"
   curl -fsS localhost:3001/health/readiness
   ```
   Kiểm tra vài tenant trọng yếu: số booking / hoá đơn / payment khớp kỳ vọng.
5. **Ghi lại** thời điểm dữ liệu (RPO thực tế) + thời lượng (RTO thực tế) vào
   incident log.

### 1a. Backup tự động (logical dump → R2)

[`infra/scripts/backup-db.sh`](../infra/scripts/backup-db.sh) — `pg_dump` custom
format → R2, chạy bằng **host cron 02:00 ICT** (KHÔNG dùng GitHub Actions: runner
không vào được DB prod private):

```cron
0 19 * * *  R2_ENDPOINT=… R2_BUCKET=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
            BACKUP_DATABASE_URL=… /path/infra/scripts/backup-db.sh >> /var/log/pms-backup.log 2>&1
```
(19:00 UTC = 02:00 ICT). Chủ nhật + đặt `R2_BUCKET_DR` → tự copy weekly sang
bucket khác vùng.

### 1b. Drill khôi phục (BẮT BUỘC theo quý — [`11` §6])

[`infra/scripts/restore-drill.sh`](../infra/scripts/restore-drill.sh): tải backup
mới nhất → restore vào **DB nháp** (`DRILL_DATABASE_URL`, KHÔNG phải prod) → sanity
+ in RTO/RPO. Chạy thủ công, hoặc qua workflow
[`.github/workflows/restore-drill.yml`](../.github/workflows/restore-drill.yml)
(`workflow_dispatch`; bỏ comment `schedule` để chạy hằng quý sau khi đã thêm
secret `R2_*`). Ghi kết quả vào bảng:

| Ngày drill | backup_key | RPO đo được | RTO đo được | Người chạy |
|---|---|---|---|---|
| _(điền sau drill đầu tiên)_ | | | | |

### 1c. Retention & cross-region

Dùng **R2 bucket lifecycle policy** (KHÔNG xoá bằng script — tránh lỡ tay): prefix
`daily/` giữ **30 ngày**, `weekly/` giữ **12 tuần** ([`11` §6]). Vd lifecycle JSON:

```json
{ "Rules": [
  { "ID": "daily-30d",  "Filter": {"Prefix": "daily/"},  "Status": "Enabled", "Expiration": {"Days": 30} },
  { "ID": "weekly-12w", "Filter": {"Prefix": "weekly/"}, "Status": "Enabled", "Expiration": {"Days": 84} }
]}
```

> ⚠️ Drill restore là **bắt buộc theo quý** — đừng để lần restore đầu tiên là lúc
> cháy nhà. Env backup (`R2_*`, `BACKUP_DATABASE_URL`, `DRILL_DATABASE_URL`) xem
> `.env.example`; secret prod để ở Doppler ([`11` §7]).

---

## 2. 🟡 Partition `audit_logs` (tạo trước / lưu trữ)

`audit_logs` partition theo tháng. `MaintenanceService.runAuditPartitionMaintenance()`
chạy trong night-audit (3 SQL function SECURITY DEFINER, migration `0026`):

- `ensure_audit_partitions(months_ahead := 3)` — tạo partition tháng tương lai.
- `detach_old_audit_partitions(keep_months := 12)` — DETACH + RENAME partition cũ
  (KHÔNG drop — dump trước khi xoá).
- `audit_partitions_missing(months_ahead := 1)` — tháng còn thiếu → cảnh báo.

**Alert "partition tháng kế chưa tồn tại"** ([`11` §9]) → night-audit chưa chạy
hoặc lỗi. Tạo thủ công ngay (an toàn, idempotent):

```sql
-- psql "$DATABASE_URL_MIGRATIONS"
SELECT ensure_audit_partitions(3);
SELECT * FROM audit_partitions_missing(1);   -- kỳ vọng: 0 dòng
```

> Vì sao quan trọng: nếu default partition đã nhận dòng trong khoảng tháng mới,
> Postgres CẤM attach partition đó → phải tạo partition **trước** khi tháng đó tới.

---

## 3. 🟠 Outbox tồn đọng (event không phát)

`outbox_events` (global, no-RLS) là nguồn sự kiện realtime/notification.
`OutboxDispatcher` claim `FOR UPDATE SKIP LOCKED` → publish Redis → đánh dấu
`PROCESSED`; retry ≥ 10 → `FAILED`; nghe `pg_notify('outbox_new')` + poll 5s +
**reclaim PROCESSING quá 60s**.

**Chẩn đoán lag:**
```sql
-- psql "$DATABASE_URL_MIGRATIONS"
SELECT status, count(*), min(created_at)
FROM outbox_events GROUP BY status ORDER BY status;
```
- `PENDING` dồn nhiều + dispatcher đang chạy → kiểm tra Redis & `ENABLE_SCHEDULERS`.
- `PROCESSING` kẹt (process chết giữa chừng) → dispatcher tự reclaim sau 60s. Nếu
  không (dispatcher đã tắt), reset thủ công:
  ```sql
  UPDATE outbox_events SET status = 'PENDING'
  WHERE status = 'PROCESSING' AND claimed_at < now() - interval '5 minutes';
  ```
- `FAILED` (retry cạn) → đọc `last_error`, sửa nguyên nhân, rồi cho phát lại có
  chủ đích:
  ```sql
  UPDATE outbox_events SET status = 'PENDING', retry_count = 0, last_error = NULL
  WHERE id = '<event_id>';
  ```

> ⚠️ Outbox dùng chung DB giữa dev và test. **Đừng chạy `pnpm dev`
> (`ENABLE_SCHEDULERS=true`) song song với e2e outbox** — dispatcher dev sẽ giành
> claim row của test. (Chi tiết: [`pms-homestay-status` memory].)

---

## 4. 🟠 Xung đột OTA / overbooking

iCal pull (5.2) khi phát hiện trùng phòng KHÔNG tự giải quyết — phát
`booking.overbooking_detected` (aggregate = `channel_resource_mappings.id`), ghi
`sync_logs`, job ở trạng thái `PARTIAL`.

**Tìm vụ overbooking gần đây:**
```sql
-- SET app.current_tenant_id = '<tenant_uuid>'; (app_user) HOẶC dùng superuser
SELECT j.id, j.channel_mapping_id, j.status, j.finished_at
FROM sync_jobs j WHERE j.status = 'PARTIAL' ORDER BY j.finished_at DESC LIMIT 20;

SELECT * FROM sync_logs WHERE level = 'WARN' ORDER BY created_at DESC LIMIT 50;
```

**Xử lý:**
1. Mở lịch (web-admin `/calendar`) đúng property/khoảng ngày → xác định 2 booking
   chồng nhau.
2. Dời 1 booking sang phòng trống: `POST /bookings/:id/switch-resource`
   `{ new_resource_id, reason }` (không cần `If-Match`; 409 `BOOKING_OVERLAP` nếu
   phòng đích cũng kẹt).
3. Nếu không còn phòng → liên hệ khách theo SLA, huỷ/hoàn theo chính sách.
4. Kiểm tra mapping/giá iCal để giảm tái diễn (lệch timezone, feed chậm).

> **Sanity-guard** của pull: nếu feed đột nhiên rỗng (< 50% so với lần trước),
> worker BỎ huỷ hàng loạt + ghi WARN (tránh xoá nhầm khi OTA lỗi). Thấy nhiều
> WARN kiểu này → feed nguồn có vấn đề, không phải dữ liệu ta sai.

---

## 5. 🟠 Payment chưa khớp (unmatched)

Webhook đối soát (Casso/SePay, 3.4) xác thực HMAC → match vào hoá đơn. Không khớp
được → nằm chờ ở **`/payments/unmatched`** (web-admin → "Đối soát").

**Chẩn đoán:**
```sql
-- SET app.current_tenant_id = '<tenant_uuid>';
SELECT count(*) FROM webhook_events_received WHERE matched_at IS NULL;
```
- Webhook **trả 503** → thiếu `PAYMENT_WEBHOOK_SECRET` (≥16 ký tự). Cấu hình rồi
  yêu cầu cổng thanh toán gửi lại.
- Có giao dịch nhưng không khớp → vào `/payments/unmatched`: chọn hoá đơn còn nợ
  để gán thủ công, hoặc **ignore** (giao dịch không thuộc hệ thống).
- Đã thu tiền mặt nhưng số dư chưa về 0 → ghi nhận qua "Record payment" trên hoá
  đơn (SSE `payment.received` sẽ cập nhật số dư realtime).

---

## 6. 🔴 Postgres / Redis sự cố

- **Postgres down** → `readiness` đỏ, mọi mutation lỗi. Khôi phục theo phương án
  hosting; sau khi lên lại, kiểm tra connection pool app (restart API nếu pool
  treo).
- **Redis down** → mất realtime (SSE), rate-limit, cache quyền, queue BullMQ.
  Auth/CRUD cốt lõi vẫn chạy (RBAC fallback đọc DB khi cache miss). Khôi phục
  Redis rồi để dispatcher/worker reclaim job. **Không** xoá queue trừ khi chắc
  chắn job hỏng.
- Sau mọi sự cố hạ tầng: chạy lại §0 health-check + liếc §3 (outbox lag).

---

## 7. 🟡 Night-audit không chạy

Night-audit (02:00, gated `ENABLE_SCHEDULERS`) làm: deposit-timeout, no-show,
OVERDUE, rollup `daily_property_stats`, chốt tháng (ngày 1), subscription
lifecycle sweep, retention, **partition maintenance** (§2).

Triệu chứng: báo cáo occupancy/ADR trống, hoá đơn quá hạn không chuyển OVERDUE,
partition tháng kế thiếu.

1. Xác nhận `ENABLE_SCHEDULERS=true` trên instance chạy cron.
2. Kiểm tra queue BullMQ trong Redis (job `night-audit`) + log worker.
3. Cần chạy gấp một phần (vd partition) → dùng SQL function trực tiếp (§2). Các
   sweep khác: bật scheduler đúng instance rồi để cron kế tiếp chạy, hoặc trigger
   thủ công qua job nếu đã wire.

---

## 8. 🟡 2FA bắt buộc cho vai trò đặc quyền

`ENFORCE_2FA_FOR_PRIVILEGED_ROLES=true` → OWNER/ACCOUNTANT **chưa bật 2FA** sẽ bị
chặn ở `/auth/login` với `403 AUTH_2FA_REQUIRED_FOR_ROLE` (mặc định OFF; chỉ chặn
login, KHÔNG chặn register/enroll).

- Bật ở prod theo **grace-period**: thông báo trước, để admin kịp bật 2FA, rồi mới
  set `true`.
- Admin tự khoá ngoài (mất thiết bị TOTP) → khôi phục qua **backup codes**. Hết
  backup codes → cần can thiệp hỗ trợ cấp nền tảng (reset 2FA cho user trong DB,
  có kiểm soát) — KHÔNG tắt enforce toàn hệ chỉ để cứu 1 user.

---

## 9. 🟡 Connection pool & noisy-neighbor (cost theo tenant)

Shared-DB + RLS → các tenant **dùng chung pool/CPU/IO** (docs/02 §11). Một tenant chạy
truy vấn nặng/nhiều có thể cạn pool, ảnh hưởng tenant khác.

**Giới hạn pool (D2).** Mỗi instance API mở pool riêng theo `connection_limit` trong
`DATABASE_URL` (vd `?connection_limit=10&pool_timeout=10`). Quy tắc: **(số instance ×
connection_limit) < `max_connections` Postgres** (trừ phần superuser + migration). Cạn
pool → request chờ tới `pool_timeout`s rồi lỗi; thủ phạm hay gặp là tx giữ connection
lâu (CẤM I/O ngoài trong `withTenant` — ADR-0002 amendment).

- PROD nên đặt **PgBouncer transaction-mode** trước Postgres (RLS an toàn vì GUC
  `app.current_tenant_id` set LOCAL/transaction-scoped — ADR-0002 §4); Prisma trỏ
  PgBouncer + `?pgbouncer=true` (tắt prepared statement), `connection_limit` nhỏ.
- Kiểm tra bão hoà connection (cluster-level):
  ```sql
  SELECT state, wait_event_type, count(*) FROM pg_stat_activity
  WHERE datname = 'pms' GROUP BY 1, 2 ORDER BY 3 DESC;
  SHOW max_connections;
  ```

**Soi cost theo tenant (noisy-neighbor).** Bật `DB_SLOW_TX_LOG_MS=<ms>` (vd 1000; 0 =
tắt) → mỗi unit-of-work `withTenant` vượt ngưỡng ghi log
`{evt:'slow_tenant_tx', tenant_id, duration_ms, read_only, request_id, url}`. Dashboard/
alert gom theo `tenant_id` (đếm + p95 `duration_ms`) → khoanh vùng tenant gây tải, đối
chiếu `url` tìm truy vấn nặng. Đặt ngưỡng đủ cao ở prod để chỉ bắt tx bất thường (tránh
nhiễu log). _(Visual dashboard dựng trên log pipeline = bước ops, như Sentry — §C1 docs/18.)_

---

## Phụ lục — biến môi trường hay liên quan sự cố

| Biến | Vai trò khi sự cố |
|---|---|
| `ENABLE_SCHEDULERS` | Bật cron/worker (outbox, night-audit, đối soát, iCal, notification). Tắt → các job "không chạy". |
| `DATABASE_URL` / `DATABASE_URL_MIGRATIONS` | app_user (RLS) / postgres (superuser, admin ops). `connection_limit`/`pool_timeout` giới hạn pool (§9). |
| `DB_SLOW_TX_LOG_MS` | >0 → log `slow_tenant_tx` (cost theo tenant, §9). 0 = tắt. |
| `PAYMENT_WEBHOOK_SECRET` | Thiếu → webhook đối soát trả 503 (§5). |
| `ENFORCE_2FA_FOR_PRIVILEGED_ROLES` | Chặn login OWNER/ACCOUNTANT chưa 2FA (§8). |
| `PLATFORM_ADMIN_SECRET` | Thiếu → xác nhận thanh toán thuê bao nền tảng trả 503. |
| `REDIS_URL` | Mất → realtime/cache/queue/rate-limit (§6). |

Liên quan: [`11` §7 secrets] · [`11` §9 alerting] · [`11` §12 DR scenarios].
