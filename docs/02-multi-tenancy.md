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

**Flow:**
```
Request → API Gateway
  → middleware `TenantResolver`:
      a. Nếu có Authorization header → decode JWT → lấy `tnt`
      b. Nếu chưa auth (login endpoint) → lấy từ subdomain hoặc X-Tenant-Slug
      c. Validate tenant tồn tại + active
      d. Inject `request.tenantId` + chạy SQL `SET LOCAL app.current_tenant_id = '<uuid>'`
  → Tiếp tục pipeline
```

**Endpoint không cần tenant** (`/health`, `/auth/login` trước resolve, `/api/v1/sync/ical/:token`): đánh dấu bằng decorator `@Public()` và `@SkipTenantScope()`.

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

```sql
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties FORCE ROW LEVEL SECURITY;  -- Áp cả cho table owner

-- Bọc NULLIF bắt buộc: khi GUC chưa set / hết hiệu lực, nó revert về '' và '''::uuid' sẽ ném 22P02.
CREATE POLICY tenant_isolation ON properties
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_insert ON properties
  FOR INSERT
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
```

> Lặp lại pattern này cho **mọi** bảng tenant-scoped. Viết một migration helper function để generate policy tự động.

### Set tenant context — `withTenant` unit-of-work ([ADR-0002](adr/0002-rls-tenant-context-and-pooling.md))

GUC `app.current_tenant_id` chỉ được set **LOCAL bên trong một interactive transaction** — statement đầu tiên set GUC, mọi truy vấn của đơn vị công việc chạy trên chính tx đó:

```typescript
// core/tenancy/tenant-context.ts
export async function withTenant<T>(
  prisma: PrismaService,
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts?: { readOnly?: boolean },
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', $1, true)`, tenantId);
    if (opts?.readOnly) await tx.$executeRawUnsafe(`SET TRANSACTION READ ONLY`);
    return fn(tx);
  }, { maxWait: 2_000, timeout: 10_000 });  // chỉnh tường minh — mặc định Prisma timeout 5s
}
```

Đóng gói bằng **Prisma Client Extension + AsyncLocalStorage (CLS)** để service không phải truyền `tx` thủ công; lập trình viên dùng `withTenant`, không gọi `prisma` trần.

**Tại sao không set GUC bằng middleware rời:** `set_config(..., true)` chạy autocommit → tx kết thúc ngay → query sau mất context (GUC revert `''` → policy ném 22P02); còn set session-level (`false`) thì GUC **leak** sang request khác dùng lại cùng connection trong pool → rò rỉ cross-tenant. Cả hai đã kiểm chứng trên PG16 — vì vậy interactive-tx là cách duy nhất đúng.

**Phạm vi transaction = unit-of-work, KHÔNG phải vòng đời request** (ADR-0002 amendment 2026-06-10):
- `withTenant` bao quanh một **đơn vị công việc DB ngắn**; một request có thể mở nhiều unit-of-work.
- **Cấm external I/O trong `withTenant`** (HTTP/OCR/S3/email). Pattern: *đọc DB (tx1) → gọi ngoài → ghi DB (tx2)*. Enforce bằng lint rule + checklist PR.
- GET read-only: `withTenant(..., { readOnly: true })` ngắn.
- **SSE / connection sống lâu:** không giữ tx — mỗi lần cần DB trong stream mở unit-of-work mới.
- Background job: set context per-job qua `withTenant` y hệt request.

**Pooling:** kết nối có RLS dùng pooler **pin-theo-transaction** (Neon pooler / Supabase / PgBouncer transaction mode — Prisma cần `?pgbouncer=true`). Tuyệt đối không đặt GUC session-level.

### Bypass RLS cho job background

Một số job (vd: chạy report cross-tenant cho admin platform) cần bypass RLS. Dùng **role riêng** `platform_admin` với `BYPASSRLS`:

```sql
CREATE ROLE platform_admin WITH LOGIN BYPASSRLS PASSWORD '...';
GRANT ALL ON ALL TABLES IN SCHEMA public TO platform_admin;
```

Application connect bằng role `app_user` (không có BYPASSRLS) cho mọi request thông thường, chỉ background admin job mới connect bằng `platform_admin`.

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
