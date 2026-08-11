# 11 — OBSERVABILITY & OPERATIONS

> **Phiên bản 3.0 (2026-06-10):** gộp về **2 vendor** (Sentry + Better Stack — bản cũ 5 vendor chồng vai trò); OTel SDK gắn từ ngày 1; sửa redact PII đa tầng; backup matrix theo phương án hosting (managed vs self-host — bản cũ trộn lẫn cả hai); retention dẫn về matrix `03` §7.

## 1. Triết lý

4 trụ cột: **Logs** (chuyện gì đã xảy ra) · **Metrics** (số đếm/latency) · **Traces** (request đi qua đâu — SDK sẵn từ ngày 1, exporter bật phase 2) · **Alerts** (báo khi vượt ngưỡng).

| Vendor | Vai trò |
|--------|---------|
| **Sentry** | Errors FE+BE, release health |
| **Better Stack** | Logs (pino ship), dashboard + alert trên log-metrics, uptime, status page |

## 2. Logging

### Format chuẩn — JSON 1 dòng

```json
{
  "level": "info", "time": "2026-06-10T07:30:00.000Z",
  "request_id": "uuid", "tenant_id": "uuid", "user_id": "uuid",
  "msg": "Booking created", "booking_id": "uuid", "duration_ms": 45, "ctx": "BookingsService"
}
```

### Quy tắc

- KHÔNG log password/secret/PII. KHÔNG `console.log` — luôn `Logger` của Nest.
- Mọi request có `request_id` (inject ở middleware, echo response header, gắn vào mọi log line + Sentry event).
- Error log có `stack`.

### Pino config — redact ĐA TẦNG

> Wildcard `*` của pino chỉ match **một** cấp key — `'*.phone'` KHÔNG bắt được `req.body.guest.phone`. Phải liệt kê path sâu theo shape thực tế + chốt chặn bằng serializer:

```typescript
LoggerModule.forRoot({
  pinoHttp: {
    level: process.env.LOG_LEVEL || 'info',
    redact: {
      paths: [
        'req.headers.authorization', 'req.headers.cookie',
        // liệt kê tường minh theo DTO thật:
        'req.body.password', 'req.body.guest_info.phone', 'req.body.guest_info.id_document_number',
        'req.body.*.password', '*.password', '*.password_hash',
        '*.id_document_number', '*.two_factor_secret', '*.token',
      ],
      censor: '[REDACTED]',
    },
    serializers: { req: redactDeep(stdSerializers.req) },   // fallback: quét đệ quy key nhạy cảm
    customProps: (req) => ({ tenant_id: req.tenantId, user_id: req.user?.sub, request_id: req.id }),
    transport: isDev ? { target: 'pino-pretty' } : undefined,  // prod: stdout → vector/agent → Better Stack
  },
});
```

> Lưu ý: số giấy tờ đã **mã hoá ở tầng DB** (ADR-0007) nên log lọt cũng chỉ thấy ciphertext — nhưng vẫn redact (defense in depth, ảnh hưởng cả raw request body).

## 3. Error tracking — Sentry

- Auto-capture: unhandled exception, promise rejection, HTTP 5xx. Manual capture: business error đáng chú ý (webhook payment fail ≥3 lần, sanity-guard iCal kích hoạt...).
- Mọi event gắn `request_id` + `tenant_id`. Source map upload trong CI.

**Triển khai (task 8.2):**
- **BE** (`@core/sentry/sentry.ts`): `initSentry(env)` ở `main.ts` (no-op nếu thiếu `SENTRY_DSN`). `captureError()` gắn `request_id`/`tenant_id`, gọi trong `HttpExceptionFilter`/`PgErrorFilter` (mọi 5xx) + sanity-guard iCal. **Coexist OTel**: `skipOpenTelemetrySetup: true` (app đã chạy `@core/otel` NodeSDK riêng) — Sentry chỉ bắt LỖI, tracing để OTel (§4).
- **FE** (`@sentry/nextjs`, web-admin + web-staff): `sentry.{client,server,edge}.config.ts` + `src/instrumentation.ts` (`onRequestError`) + `global-error.tsx`; `withSentryConfig` ở `next.config.ts` upload source map khi CI có `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT`. No-op nếu thiếu `NEXT_PUBLIC_SENTRY_DSN`.
- **Kích hoạt**: set DSN (env BE + `NEXT_PUBLIC_SENTRY_DSN` FE) lúc deploy; thêm token source-map vào CI secrets. Alert rules (§9) + log dashboards/uptime cấu hình trên Sentry + Better Stack (ops). _web-admin đã chuyển `sentry.client.config.ts` → `src/instrumentation-client.ts` (Next 15.3+ nạp native cho cả webpack lẫn Turbopack, nên `pnpm dev:turbo` vẫn có Sentry). web-staff thì chưa._

## 4. Metrics & Tracing

- **OTel SDK từ ngày 1:** `@opentelemetry/sdk-node` auto-instrument HTTP/Express/PG/Redis — trace context sẵn trong log (`trace_id`); exporter (Tempo/Honeycomb) bật khi cần, không phải cài lại.
- **Metrics MVP qua structured log** (đếm/percentile trên Better Stack dashboards): HTTP latency p50/95/99 per route, error rate, BullMQ queue depth + fail count, SSE connections, outbox lag (`now() - min(created_at) WHERE status='PENDING'`), DB pool usage.
- Business metrics: bookings/giờ, payment success/fail, sync success rate per channel, **overbooking conflicts/ngày**, unmatched payments tồn.
- Prometheus + Grafana self-host: phase 2 nếu cần metrics engine thật; không thêm vendor thứ 3 ở MVP.

## 5. Health checks

```
GET /health/liveness   — process sống (200, không check phụ thuộc)
GET /health/readiness  — nhận traffic được không (DB + Redis ping)
GET /health/startup    — init xong chưa (migration applied)
```

- LB/uptime probe `readiness` mỗi 10s. **Response public chỉ trả status code + `{"status":"ok|degraded"}`** — chi tiết từng dependency chỉ trả khi có internal token (tránh lộ topology).

## 6. Backup & recovery

> Đây là **chính sách/thiết kế** backup. Thao tác chạy/khôi phục cụ thể (lệnh, drill từng bước): xem [`17-oncall-runbook.md` §1](17-oncall-runbook.md).

### Chọn theo phương án hosting (chốt cùng ADR-0004)

| | (A) Managed PG (provider VN/SG) | (B) Self-host trên VPS |
|---|---|---|
| PITR | **Của provider** (verify retention ≥7 ngày) | `pgBackRest` WAL archiving → R2, PITR 30 ngày |
| Daily logical | `pg_dump` 02:00 ICT → R2 (bản ta tự giữ, độc lập provider), retention 30 ngày | Như (A) |
| Cross-region | Copy dump weekly sang region 2, retention 12 tuần | Như (A) |

> `pg_dump` là **logical backup** — tự nó KHÔNG làm được PITR; PITR đến từ WAL archiving (hoặc của provider). Đừng nhầm hai thứ này khi viết runbook.

### Test restore — BẮT BUỘC quarterly drill

1. Spin up DB mới từ backup gần nhất → connect app staging → sanity (login, list bookings, tạo booking).
2. Document RTO/RPO đo được thực tế vào runbook.

### Export theo tenant (NĐ13 data portability)

`POST /api/v1/tenant/data-export` → job stream từng bảng (client-side cursor — **không** dùng server-side `COPY TO file`, managed PG không cho phép) → CSV → zip → S3 signed link 7 ngày → email OWNER.

## 7. Secrets management

- **Dev:** `.env.local` (không commit) + `.env.example`. **Staging/Prod:** Doppler.
- Khoá mã hoá PII (AES + HMAC — ADR-0007) tách khỏi `DATABASE_URL`, có `key_id` để rotate.
- Rotation: DB password 90 ngày; JWT signing key khi có incident; webhook secret 180 ngày (notify trước 30 ngày).
- Env validation bằng Zod schema — **crash startup nếu thiếu** (fail fast):

```typescript
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  PII_ENC_KEY_CURRENT: z.string().min(44),     // base64 32B, prefix key_id
  PII_HMAC_KEY: z.string().min(44),
  S3_BUCKET: z.string(), S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string(), S3_SECRET_KEY: z.string(),
  SENTRY_DSN: z.string().url().optional(),
});
```

## 8. CI/CD

### Pipeline (GitHub Actions)

```yaml
on: { pull_request: , push: { branches: [main] } }
jobs:
  test:
    steps:
      - checkout · setup-node 22 · pnpm install
      - lint (eslint 9 flat, prettier) · typecheck
      - unit-test (vitest) · integration-test (docker-compose pg16 + redis7)
      - migration-test: apply TOÀN BỘ SQL migrations vào DB ephemeral + introspection check sạch (ADR-0001)
      - e2e (playwright) — gồm tenant-isolation interleaved + overbooking concurrent
      - build (turbo) · security (pnpm audit, snyk, gitleaks, trivy image scan)
  deploy-staging:  needs: test · if main · deploy + smoke + notify
  deploy-prod:     needs: deploy-staging · workflow_dispatch (manual) · rolling + smoke
```

### Database migration

- **Forward-only**, backward-compatible với code đang chạy (migration apply trước, deploy app sau).
- Không `DROP COLUMN` trực tiếp: deprecate ở code → deploy → 1-2 release sau mới drop.
- Tool: migration SQL-first (`node-pg-migrate`/`dbmate`) + `prisma db pull && prisma generate` sau mỗi migration — gói trong `pnpm db:migrate`; **không dùng** `prisma migrate deploy`.

### Environments

| Env | Deploy | Data |
|-----|--------|------|
| local | — | Seed |
| staging | Auto từ main | Anonymized |
| prod | Manual approve | Real |

## 9. Alerting

| Alert | Ngưỡng | Severity |
|-------|--------|----------|
| 5xx rate | >1%/5' warning · >5%/5' | critical, on-call |
| DB CPU / pool | >80%/10' · pool >90% | warning |
| **Outbox lag** | PENDING tồn >60s | warning (realtime đang chết) |
| **Reclaim PROCESSING** | có row bị reclaim | warning (worker crash) |
| BullMQ failed | >100/h | warning |
| Sync fail | 3 lần liên tiếp 1 channel | warning |
| **Overbooking detected** | ≥1 | critical — notify OWNER + team |
| **Unmatched payments** | tồn >10 hoặc >24h | warning cho ACCOUNTANT |
| Webhook signature mismatch | tăng đột biến | warning (possible attack) |
| Disk | >85% | warning |
| Backup không chạy | >26h | critical |
| **vietnam_holidays năm sau trống** | tháng 11 hằng năm | warning (giá Tết sai nếu quên) |

- Channels: Slack #alerts; critical → PagerDuty/phone on-call. Uptime: Better Stack probe 1' × 3 region + status page public.

> Khi một alert nổ, quy trình xử lý theo kịch bản (outbox lag, overbooking, unmatched payment, night-audit, Postgres/Redis…): xem [`17-oncall-runbook.md`](17-oncall-runbook.md) §3–§7.

## 10. Performance budget

| Endpoint | p95 target |
|----------|------------|
| GET list (20 items) | < 200ms |
| GET detail | < 100ms |
| POST mutation | < 400ms |
| POST /pricing/quote | < 100ms |
| iCal pull / mapping | < 30s |
| Report P&L (đọc rollup) | < 300ms |
| SSE event end-to-end (commit → client) | < 500ms |

> Benchmark chạy **nightly trên runner cố định** (k6, dataset chuẩn) — KHÔNG fail PR theo benchmark trên shared runner (noise > signal); regression >30% → tạo issue tự động.

**Triển khai (task 8.3):** k6 scripts ở [`infra/k6/`](../infra/k6/) — `load-test.js`
(100 user duyệt + báo giá + 1000 booking, threshold theo bảng trên) + `sse-soak.js`
(500 kết nối SSE). Chạy vào **staging** qua workflow
[`.github/workflows/load-test.yml`](../.github/workflows/load-test.yml)
(`workflow_dispatch`, gated secret `LOADTEST_TARGET_URL`). Xem [`infra/k6/README.md`](../infra/k6/README.md).

## 11. Bố trí VPS

```
/opt/pms/                 — code deploy (docker compose)
/var/lib/postgres/data/   — DB (self-host) — volume riêng, NVMe nếu có
/var/backups/postgres/    — staging backup trước khi upload S3
logs: container stdout → vector agent → Better Stack (không ghi file local)
```

## 12. Disaster recovery scenarios

> Đây là **ma trận mục tiêu** RTO/RPO. Các bước thao tác khôi phục thực tế: xem [`17-oncall-runbook.md` §1](17-oncall-runbook.md) (restore) và §6 (Postgres/Redis sự cố).

| Scenario | RTO | RPO | Plan |
|----------|-----|-----|------|
| App crash | <1' | 0 | systemd/compose restart policy |
| Bug ở version mới | <5' | 0 | Rollback image (migration đã backward-compatible) |
| DB crash | <15' | <5' | PITR (provider hoặc pgBackRest) |
| Region down | <2h | <1h | Restore cross-region dump + đổi DNS |
| Tenant yêu cầu xoá | <24h | — | Soft delete → hard delete sau 90 ngày (legal-hold check — `12` §4) |
| Phát hiện data corruption muộn | <8h | đến thời điểm corruption | PITR về trước corruption + reconcile thủ công phần sau |

## 13. Retention

Toàn bộ theo **matrix `03-database-erd.md` §7** (audit partition 12 tháng nóng + archive ≥10 năm; sync_logs 30d; outbox 7d/90d; v.v.) — night-audit job thực thi (`09` §9). Khi thêm bảng log mới: bắt buộc khai dòng retention (checklist PR).
