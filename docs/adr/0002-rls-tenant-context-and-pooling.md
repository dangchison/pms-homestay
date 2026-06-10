# ADR-0002 — RLS tenant context theo interactive transaction + chiến lược pooling

- **Status:** Accepted
- **Ngày:** 2026-06-09
- **Liên quan:** review §E2, §A1

## Context

`02-multi-tenancy.md` đặt tenant context bằng middleware:

```ts
await prisma.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', $1, true)`, tenantId);
next();
```

Phân tích (đã kiểm chứng trên PostgreSQL 16) cho thấy pattern này **sai**:

- `set_config(..., true)` (LOCAL) chỉ sống trong transaction hiện tại. Lệnh đó chạy autocommit → tx kết thúc ngay → query sau **mất context**. Thực tế GUC revert về `''` và `''::uuid` trong policy **ném lỗi 22P02**.
- "Sửa" bằng session-level (`false`) thì GUC **leak** sang request kế tiếp dùng lại cùng connection trong pool → rò rỉ cross-tenant.
- Prisma dùng prepared statements → còn xung khắc PgBouncer transaction mode.

## Decision

1. **Mỗi request mở một interactive transaction; statement đầu tiên set GUC LOCAL; mọi query nghiệp vụ chạy trong tx đó.** (đã kiểm chứng đúng & cô lập kể cả pool nhỏ + concurrency interleaved trên PostgreSQL 16.)
   ```ts
   await prisma.$transaction(async (tx) => {
     await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', $1, true)`, tenantId);
     // ...toàn bộ truy vấn của request chạy trên `tx`...
   });
   ```
   Đóng gói bằng **Prisma Client Extension** + **AsyncLocalStorage (CLS)** để controller/service không phải truyền `tx` thủ công; expose helper `withTenant(tenantId, fn)` dùng cho cả request lẫn background job.
2. **Policy guard chống chuỗi rỗng:**
   ```sql
   USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
   ```
   (Tránh đúng lỗi `''::uuid` nêu trên.)
3. **App connect bằng role `app_user`** (`NOSUPERUSER`, không `BYPASSRLS`). Bật `ENABLE` + `FORCE ROW LEVEL SECURITY` để kể cả owner cũng bị áp.
4. **Pooling:** kết nối có RLS phải dùng pooler **pin theo transaction** (Supabase session-mode cho các kết nối này, hoặc Neon pooler). **Tuyệt đối không** đặt GUC ở session-level. Nếu dùng PgBouncer transaction mode: interactive tx vẫn an toàn (pin trong tx) nhưng cần `?pgbouncer=true` cho Prisma prepared statements.
5. **Background worker / cron:** set tenant context per-job y hệt request qua `withTenant`. Job cross-tenant của platform admin dùng role riêng có `BYPASSRLS`.
6. **Test bắt buộc:** test concurrency *interleaved* (2 tenant đan xen trên pool nhỏ) trong CI — test tuần tự không phát hiện leak.

## Consequences

**Tích cực:** isolation đúng & không leak (đã chứng minh); defense-in-depth thật (code bug vẫn không lọt).

**Tiêu cực:** mọi request là 1 transaction (overhead nhỏ; request read-only có thể mở tx `READ ONLY`); cần lớp extension/CLS; lập trình viên phải dùng `withTenant`, không gọi `prisma` trần.

## Alternatives considered

- **Prisma middleware tự chèn `WHERE tenant_id`** — *Bác bỏ:* một raw query quên là leak; không phải hàng phòng thủ DB-level.
- **Session GUC + `DISCARD ALL` khi release connection** — *Bác bỏ:* mong manh, phụ thuộc pool reset; vẫn rủi ro với transaction-mode pooler.
- **DB-per-tenant** — để dành cho tenant enterprise (hybrid sau này), không cho MVP.

---

## Amendment 2026-06-10 — Phạm vi transaction: unit-of-work, KHÔNG bọc cả request

Audit lần 2 chỉ ra rủi ro nếu hiểu Decision §1 là "bọc **toàn bộ** request trong một transaction":

- **Cạn connection pool:** I/O ngoài (gọi OCR FPT ~15s, upload S3, HTTP ra OTA) nằm trong tx sẽ giữ connection suốt thời gian đó. Throughput trần = pool_size ÷ thời gian request. 10 check-in OCR đồng thời = 10 connection bị ghim.
- **Prisma interactive transaction có timeout mặc định 5s** (P2028) — request chậm sẽ vỡ hàng loạt.
- `idle_in_transaction` lâu chặn autovacuum, giữ lock, tăng deadlock.
- Kết nối dài (SSE stream sống hàng giờ) tuyệt đối không thể nằm trong tx.

**Quy tắc chuẩn (bổ sung vào Decision):**

1. `withTenant(tenantId, fn)` bao quanh **một đơn vị công việc DB** (unit-of-work), không phải vòng đời request. Một request có thể mở 1–N unit-of-work ngắn.
2. **Cấm external I/O bên trong `withTenant`** (HTTP, S3, OCR, gửi mail…). Pattern đúng: *đọc DB (tx1) → gọi ngoài → ghi DB (tx2)*, mỗi tx tự set GUC. Enforce bằng lint rule + code review checklist.
3. GET read-only đơn giản: dùng `withTenant` mở tx `READ ONLY` ngắn (vẫn cần tx vì GUC là LOCAL).
4. Cấu hình rõ `transactionOptions` (maxWait/timeout) cho Prisma; alert khi tx > 1s.
5. **SSE / long-lived connection:** không giữ tx. Mỗi lần cần đọc DB trong stream → mở unit-of-work mới. Authorization snapshot tại thời điểm subscribe + re-check theo TTL.
6. Background job: mỗi job = một/n unit-of-work qua `withTenant`, y hệt request.
