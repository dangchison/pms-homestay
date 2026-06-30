# 02 — CHIẾN LƯỢC MULTI-TENANCY

## 1. Quyết định: Shared DB + Shared Schema + tenant_id + Row-Level Security

Có 3 mô hình multi-tenancy phổ biến:

| Mô hình | Cách ly | Chi phí | Phức tạp | Phù hợp |
|---------|---------|---------|----------|---------|
| **A. DB-per-tenant** | Cao nhất | Cao (mỗi tenant 1 DB) | Cao (deploy/backup từng DB) | Enterprise, ngân hàng |
| **B. Schema-per-tenant** | Cao | Trung bình | Trung bình (mỗi tenant 1 schema) | SaaS có vài chục khách hàng lớn |
| **C. Shared schema + tenant_id** | Cần code/RLS chuẩn | Thấp nhất | Thấp | **SaaS B2B SMB, MVP** ✓ |

**Quyết định cho MVP:** Mô hình C, **kèm PostgreSQL Row-Level Security** làm hàng phòng thủ thứ hai. Khi nào có khách hàng enterprise đòi hỏi DB riêng, có thể migrate sang mô hình hybrid (mặc định C, một số tenant được tách ra mô hình B).

**Đề xuất 3 cách triển khai cách ly và đề xuất chọn:**

- **Cách 1 (KHUYẾN NGHỊ):** `tenant_id` column ở mọi bảng + RLS policy + middleware set `SET LOCAL app.current_tenant_id` mỗi request. → Cách ly mạnh nhất, code application có sai vẫn an toàn.
- **Cách 2:** `tenant_id` column + Prisma middleware tự động inject `WHERE tenant_id = ?`. → Phụ thuộc hoàn toàn vào ORM, một raw query quên là leak.
- **Cách 3:** Discriminator subdomain nhưng vẫn 1 DB chung, không có cột tenant_id, dùng schema-per-tenant. → Phức tạp migration.

## 2. Tenant resolution (xác định tenant từ request)

**Cách xác định tenant_id từ request đến:**

1. **Subdomain (production):** `acme.pmsapp.vn` → tenant `acme`.
2. **Header `X-Tenant-Slug` (development, mobile app):** Cho phép override.
3. **JWT claim `tnt`:** Sau khi user login, JWT chứa `tnt: <tenant_id>`. Đây là **source of truth** sau khi auth. Subdomain/header chỉ dùng cho login flow.

**Flow** (thực tế: [tenant-resolver.middleware.ts](../apps/api/src/core/tenancy/tenant-resolver.middleware.ts) → guard chain → `withTenant`):
```
Request
  → TenantResolverMiddleware (CHỈ gắn req.tenantId, không set GUC):
      a. Có Authorization → decode (chưa verify) claim `tnt`
      b. Chưa auth → slug từ subdomain hoặc X-Tenant-Slug → tra tenants
         (không tồn tại → 404; SUSPENDED/CHURNED → 403)
  → Guard chain: JwtAuthGuard (verify token) → TenantGuard (bắt buộc có req.tenantId)
      → PermissionsGuard (CROSS-CHECK user.tnt === req.tenantId → 403 nếu lệch) → TenantStatusGuard
  → Handler gọi withTenant(...) — GUC app.current_tenant_id set Ở ĐÂY (LOCAL trong tx), KHÔNG ở middleware
```

> Middleware decode claim `tnt` **không verify chữ ký** — an toàn vì `JwtAuthGuard` verify token và `PermissionsGuard` cross-check `user.tnt === req.tenantId` trước mọi thao tác (defense-in-depth, xem `04` §guard). GUC chỉ được set trong `withTenant` (§4), không phải middleware (lý do: [ADR-0002](adr/0002-rls-tenant-context-and-pooling.md)).

**Endpoint không cần tenant** (`/health`, `/auth/login`, `/api/v1/public/sync/ical/:token`): đánh dấu `@Public()` và/hoặc `@SkipTenantScope()`.

## 3. Schema database

### Bảng global (không có tenant_id)

```sql
-- Mỗi khách hàng SaaS = 1 tenant
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(64) UNIQUE NOT NULL,             -- 'acme' trong acme.pmsapp.vn
  display_name VARCHAR(255) NOT NULL,
  business_type VARCHAR(32),                    -- HOMESTAY_CHAIN, INDIVIDUAL, R2R_OPERATOR
  status VARCHAR(16) NOT NULL DEFAULT 'TRIAL',  -- TRIAL, ACTIVE, SUSPENDED, CHURNED
  subscription_plan_id UUID,
  trial_ends_at TIMESTAMPTZ,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  currency CHAR(3) NOT NULL DEFAULT 'VND',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscription_plans (
  id UUID PRIMARY KEY,
  code VARCHAR(32) UNIQUE NOT NULL,             -- FREE, STARTER, PRO, ENTERPRISE
  max_properties INT NOT NULL,
  max_rooms INT NOT NULL,
  max_users INT NOT NULL,
  monthly_price_vnd BIGINT NOT NULL,
  features JSONB NOT NULL DEFAULT '{}'::jsonb
);
```

> **`persons`** (Phase 3, docs/16 — migration 0030) cũng là bảng **global** (không `tenant_id`, không RLS): danh tính khách TOÀN CỤC để nhận diện "cùng 1 người" xuyên tenant. **Pseudonymous** — chỉ `national_id_hash` (= `guests.id_document_number_hash`) + counters phi-PII, KHÔNG chứa PII. PII khách vẫn ở `guests` (tenant-scoped, RLS). Nhận diện cross-tenant chỉ trả cờ (returning/blacklisted-elsewhere) — KHÔNG lộ PII. Không nằm `NO_RLS_ALLOWLIST` vì guard chỉ quét bảng CÓ `tenant_id`.

### Bảng tenant-scoped (mọi bảng business khác)

Tất cả các bảng business **bắt buộc** có:
- `tenant_id UUID NOT NULL REFERENCES tenants(id)`
- Index trên `tenant_id` (hoặc composite index có tenant_id đứng đầu)
- RLS policy

Ví dụ:
```sql
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(255) NOT NULL,
  -- ... các cột khác
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_properties_tenant ON properties(tenant_id);
```

## 4. Row-Level Security setup

### Bật RLS cho mọi bảng tenant-scoped

Mỗi bảng tenant-scoped bật `ENABLE` + `FORCE ROW LEVEL SECURITY` + policy `USING`/`WITH CHECK` so `tenant_id` với GUC `app.current_tenant_id` (bọc `NULLIF(..., '')` để fail-closed khi GUC trống — tránh `22P02`). Thực tế dùng **một helper SQL `enforce_tenant_isolation('<table>')`** sinh policy tự động ([infra/migrations-sql/0001_extensions.sql](../infra/migrations-sql/0001_extensions.sql)) — đã phủ 35/35 bảng.

> **Nguồn chính (chi tiết policy + lý do `FORCE` + NULLIF guard):** [ADR-0002 §Decision 3–4](adr/0002-rls-tenant-context-and-pooling.md). Không lặp lại SQL ở đây để tránh lệch khi sửa.

### Set tenant context — `withTenant` unit-of-work ([ADR-0002](adr/0002-rls-tenant-context-and-pooling.md))

Đường **duy nhất** chạm bảng tenant-scoped là helper `withTenant(prisma, tenantId, fn, opts?)` ([apps/api/src/core/tenancy/with-tenant.ts](../apps/api/src/core/tenancy/with-tenant.ts)) — đã có **177 call-site** trên toàn API. Cơ chế cốt lõi:

- Mở **interactive transaction**; câu lệnh đầu tiên `SELECT set_config('app.current_tenant_id', $1, true)` đặt GUC **LOCAL** (tự reset khi tx kết thúc → an toàn với pooler transaction-mode).
- Gắn `{tenantId, tx}` vào **AsyncLocalStorage (CLS)** → service sâu lấy `currentTenantTx()` không cần truyền `tx` tay ([tenant-cls.ts](../apps/api/src/core/tenancy/tenant-cls.ts)).
- Transaction = **một unit-of-work ngắn**, KHÔNG phải vòng đời request; **cấm external I/O** (HTTP/OCR/S3/email) bên trong; GET đọc dùng `{ readOnly: true }`; SSE/long-lived không giữ tx; background job set context per-job y hệt request.

> **Nguồn chính (code đầy đủ + vì sao interactive-tx là cách duy nhất đúng — middleware `set_config` rời gây mất context/leak; pooling pin-theo-tx; amendment unit-of-work):** [ADR-0002](adr/0002-rls-tenant-context-and-pooling.md). Không lặp lại ở đây.

### Bypass RLS cho job background

Job cross-tenant của platform admin (report toàn hệ) connect bằng **role riêng có `BYPASSRLS`**; mọi request thường connect bằng `app_user` (non-superuser, không BYPASSRLS — superuser/owner vẫn bị `FORCE RLS` áp). Chi tiết role & lý do: [ADR-0002 §Decision 3, 5](adr/0002-rls-tenant-context-and-pooling.md).

## 5. Tenant onboarding flow

1. User đăng ký trên landing page → tạo tenant + user OWNER.
2. Hệ thống sinh slug (vd: từ email `nguyen@homestay.vn` → slug `homestay-nguyen-001`).
3. Default subscription = `TRIAL`, hết hạn sau 14 ngày.
4. Seed data mẫu (1 property demo + 3 room demo + 1 booking demo) để OWNER có ngữ cảnh.
5. Gửi email welcome + onboarding checklist.

## 6. Tenant lifecycle states

```
TRIAL ──(payment OK)──→ ACTIVE
   │
   └──(trial expired)──→ SUSPENDED ──(payment)──→ ACTIVE
                              │
                              └──(60 ngày)──→ CHURNED (read-only 90 ngày → archived)
```

- **SUSPENDED:** Đọc được, không tạo booking mới, không sync OTA.
- **CHURNED:** Chỉ admin platform xem được.
- **ARCHIVED:** Dump ra S3, xóa khỏi DB primary sau 12 tháng (compliance Nghị định 13).

## 7. Backup & restore theo tenant

Vì shared DB, export theo tenant chạy **client-side** (server-side `COPY TO file` cần quyền ghi file trên server PG — không khả dụng trên managed PG như Neon/Supabase):

```bash
# psql \copy = client-side, chạy được mọi nơi (role platform_admin BYPASSRLS)
psql "$DATABASE_URL" -c "\copy (SELECT * FROM bookings WHERE tenant_id = '<uuid>') TO 'tenant-<uuid>-bookings.csv' CSV HEADER"
```

Tự động hoá trong app: job `tenant-export` stream từng bảng (cursor) → ghi CSV → zip → upload S3, signed link 7 ngày (phục vụ cả data-portability NĐ13 — xem `11` §6).

## 8. Test multi-tenant isolation

Bắt buộc có test E2E:
1. Tạo 2 tenant A, B với data riêng.
2. Login user của A → gọi mọi list endpoint → verify không thấy dữ liệu của B.
3. Cố tình gửi request với `id` của B trong path → expect 404 (không phải 403, để tránh leak existence).
4. **Test concurrency *interleaved* (bắt buộc):** chạy đồng thời (Promise.all) nhiều request đan xen của A và B trên pool nhỏ; verify không lẫn dữ liệu. Test tuần tự (bước 2) KHÔNG phát hiện leak do pooling.
5. Test FK chéo tenant: insert booking của A trỏ tới resource của B → expect bị composite FK từ chối (ADR-0005).
6. Run trong CI mỗi PR.

## 9. Pitfalls hay gặp

| Lỗi | Cách phòng |
|-----|-----------|
| Foreign key không kiểm tra tenant_id | **Composite FK `(tenant_id, fk_id)`** cho mọi FK tenant-scoped (ADR-0005) — RI bypass RLS nên RLS một mình không đủ |
| `JOIN` quên `WHERE tenant_id` | RLS sẽ catch, nhưng vẫn nên explicit để index hiệu quả |
| Raw SQL bypass Prisma | Phải có code review checklist + linter rule |
| External I/O (OCR/S3/HTTP) bên trong `withTenant` | Cấm — giữ connection, cạn pool (ADR-0002 amendment); lint rule + checklist PR |
| File upload S3 không có tenant prefix | Quy ước path: `s3://bucket/{tenant_id}/{entity}/{id}/...` |
| Cache key không có tenant prefix | Quy ước key Redis: `tnt:{tenant_id}:...` |
| Background job thiếu tenant context | Job payload luôn carry tenant_id, worker bọc xử lý trong `withTenant` |

## 10. Shared-schema + RLS vs. Separate-schema — làm rõ

Câu hỏi hay gặp: "dự án có dùng *shared database + separate schema* không?" — **Không.** Mô hình hiện tại là **shared database + shared schema (`public`) + `tenant_id` + RLS** (mô hình C §1). Phân biệt:

| Tiêu chí | **Hiện tại: shared schema + RLS** | Separate schema/tenant | DB/tenant |
|---|---|---|---|
| Cách ly | Logic (RLS policy + composite FK) | Vật lý mềm (mỗi tenant 1 PG schema) | Vật lý cứng |
| Chi phí/onboarding | Thấp nhất — chỉ INSERT `tenants` | Phải `CREATE SCHEMA` + migrate mỗi tenant | Provision DB mỗi tenant |
| Migration | 1 lần áp mọi tenant | N schema × migration | N DB × migration |
| Noisy neighbor | Có (chung pool/CPU) | Giảm một phần | Cách ly tốt |
| Hợp với Prisma | **Có** (1 datasource) | **Kém** — Prisma không switch schema runtime (xem `plans/prisma-multi-schema-risk-analysis.md`) | Cần N client |

Có plan thăm dò chuyển separate-schema (`plans/multi-tenancy-schema-per-tenant.md`) nhưng **chưa triển khai** — xem khuyến nghị ở §12.

## 11. Ưu / nhược điểm (cân bằng)

**Ưu:**
- Chi phí hạ tầng thấp, onboarding tenant tức thì (self-signup §5), vận hành đơn giản.
- **Defense-in-depth thật:** RLS (DB-level) + composite FK + guard cross-check — code bug vẫn không lọt cross-tenant (đã chứng minh bằng test §8).
- Fail-closed: chưa set GUC → 0 dòng (không lộ dữ liệu).
- Báo cáo/maintenance cross-tenant dễ (1 DB).

**Nhược (kèm giảm thiểu hiện tại):**
| Nhược điểm | Giảm thiểu |
|---|---|
| Noisy neighbor (chung pool/CPU/IO) | `connection_limit`/`pool_timeout` trong `DATABASE_URL` + PgBouncer transaction-mode (ADR-0002 §4); giám sát cost theo tenant qua `DB_SLOW_TX_LOG_MS` → log `slow_tenant_tx`. Vận hành: [docs/17 §9](17-oncall-runbook.md) (D2 ✅) |
| Migration áp mọi tenant cùng lúc (blast radius) | Bắt buộc migration backward-compatible + staging drill |
| Backup/restore per-tenant thủ công | Export client-side theo `tenant_id` (§7); chấp nhận cho quy mô hiện tại |
| `tenant_id` lặp ở mọi bảng | Chi phí lưu trữ nhỏ; đánh đổi để có RLS |
| Trần compliance (không cô lập vật lý) | Hybrid khi có khách enterprise (§12) |

## 12. Đánh giá độ ổn định & rủi ro dài hạn

**Kết luận:** kiến trúc **đủ vững để phát triển lâu dài, không có rủi ro chí mạng** — chạy tốt tới hàng trăm–vài nghìn tenant. Bằng chứng đã kiểm chứng: `withTenant` 177 call-site; RLS phủ **35/35** bảng; `PermissionsGuard` backstop `user.tnt !== req.tenantId`; test isolation interleaved + fail-closed + WITH CHECK (§8).

Xếp hạng rủi ro:
- 🔴 **Lớn nhất (âm thầm) — quên bật RLS khi thêm bảng mới.** Hiện phụ thuộc kỷ luật người viết migration; ESLint chặn `this.prisma.<model>` nhưng **không có guard tự động** kiểm "mọi bảng có `tenant_id` đã `FORCE RLS`". Một bảng quên RLS → rò rỉ chéo âm thầm. → **Đề xuất CI meta-test** quét `pg_class`/`pg_policy` ([docs/18 P2-D](18-phase2-backlog.md)).
- 🟠 **Vận hành:** noisy neighbor; migration blast radius; backup per-tenant thủ công; trần compliance (xem §11).
- 🟠 **Chiến lược — KHÔNG vội migrate sang separate-schema.** `plans/prisma-multi-schema-risk-analysis.md` cho thấy Prisma không hỗ trợ multi-schema runtime → migration **rủi ro hơn** giữ nguyên. Khi cần cô lập 1–2 khách lớn → dùng **hybrid** (tách riêng tenant đó ra DB/schema), không migrate toàn bộ.
- 🟢 **Nhỏ (đã giảm thiểu):** raw SQL phải trong `withTenant`; rà `@SkipTenantScope`; cấm external I/O trong tx.

## 13. Luồng dữ liệu cần KIỂM TRA & KIỂM SOÁT (audit định kỳ)

Bổ sung góc *kiểm soát/review* cho bảng Pitfalls §9 — rà khi review PR và audit định kỳ:

1. **Mọi truy vấn tenant-scoped trong `withTenant`** — đặc biệt raw SQL `$queryRaw`/`$executeRaw` (lint exempt prefix `$`): xác nhận nằm trong context, không chạy trần.
2. **External I/O (OCR/S3/HTTP/email/SMS) KHÔNG nằm trong `withTenant`** — tránh cạn pool (ADR-0002 amendment).
3. **Background job / cron / outbox worker** mang `tenant_id` trong payload và bọc `withTenant` per-job (job cross-tenant chỉ platform admin + BYPASSRLS).
4. **SSE / long-lived** không giữ tx; mỗi lần đọc DB trong stream mở unit-of-work mới + re-check authorization theo TTL.
5. **FK tenant-scoped là composite `(tenant_id, fk_id)`** (không FK đơn) — RI bypass RLS (ADR-0005).
6. **S3 key & Redis cache key có tenant prefix** (`{tenant_id}/...`, `tnt:{tenant_id}:...`).
7. **Endpoint `@SkipTenantScope`/`@Public`** — rà soát danh sách định kỳ (bề mặt tấn công; phải tự resolve tenant an toàn, vd iCal token qua `resolve_ical_token` SECURITY DEFINER).
8. **Pooler pin-theo-transaction**; tuyệt đối không đặt GUC session-level.
9. **Bảng mới** đi đủ bộ: `tenant_id` + `UNIQUE(tenant_id,id)` + composite FK + `enforce_tenant_isolation('<table>')` + test isolation.
