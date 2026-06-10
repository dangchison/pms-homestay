# ADR-0001 — ORM & quản lý schema: SQL-first migrations + Prisma làm typed client

- **Status:** Accepted
- **Ngày:** 2026-06-09
- **Liên quan:** review §E1, §B5; [ADR-0002](0002-rls-tenant-context-and-pooling.md), [ADR-0005](0005-tenant-isolation-composite-fk.md)

## Context

Hệ thống phụ thuộc nặng vào tính năng PostgreSQL-native mà Prisma **không** mô hình hoá được trong schema của nó:

- Row-Level Security (policy, `FORCE RLS`)
- `EXCLUDE USING gist` + `btree_gist` (chống overbooking)
- Trigger, function PL/pgSQL (enforce invariant tài chính, cross-table check)
- Generated column (`balance_vnd`)
- Partial index / partial unique (`WHERE deleted_at IS NULL`)
- Composite FK `(tenant_id, id)` (xem ADR-0005)
- `citext`, advisory lock

Nếu dùng `prisma migrate` làm nguồn sự thật, các đối tượng trên phải nhét vào raw SQL rời rạc, và `prisma migrate diff` sẽ **không hiểu** chúng → sinh migration phá hỏng, drift giữa `schema.prisma` và DB thật. Đây là ma sát đã được cảnh báo ngay trong `01-tech-stack.md`.

## Decision

1. **SQL-first migrations là nguồn sự thật của schema.** Dùng một công cụ migration thuần SQL có thứ tự + bảng `schema_migrations` (đề xuất: `node-pg-migrate` hoặc `dbmate`; cho phép viết SQL tay 100%). Mọi đối tượng — bảng, RLS, EXCLUDE, trigger, generated column, partial index, composite FK — đều khai báo bằng SQL.
2. **Giữ Prisma CHỈ như typed client.** Sau mỗi migration, chạy `prisma db pull` (introspection) → `prisma generate`. App vẫn query type-safe bằng Prisma Client (giữ DX tốt, team đã quen). Phần Prisma không biểu diễn được đánh dấu `Unsupported(...)` trong schema introspected — không sao vì các thao tác đó dùng `$queryRaw`/`$executeRaw`.
3. **Không dùng `prisma migrate dev/deploy`** cho production.

> Lựa chọn thay thế tương đương về chất lượng: **Drizzle + drizzle-kit** (vừa typed client vừa migration gần-SQL). Nếu team muốn 1 công cụ duy nhất thay vì "migration tool + Prisma client", Drizzle là lựa chọn được chấp nhận. Quyết định mặc định ở đây giữ Prisma client để giảm rủi ro đổi DX giữa chừng.

## Consequences

**Tích cực**
- Mọi tính năng Postgres-native là first-class, không drift.
- App vẫn type-safe; không phải viết tay mọi query.
- Migration review được như code SQL bình thường; forward-only dễ kiểm soát.

**Tiêu cực / chi phí**
- Hai bước: chạy migration tool → `prisma db pull && generate`. Cần script `pnpm db:migrate` gói cả hai + CI check "introspection sạch".
- Một số kiểu (generated column, `citext`, range) Prisma map hạn chế → dùng `$queryRaw` cho phần đó.
- Mất tính năng `prisma migrate` (shadow db diff). Đổi lại bằng test migration trên DB ephemeral trong CI.

## Alternatives considered

- **Prisma migrate làm nguồn sự thật** — *Bác bỏ:* không biểu diễn RLS/EXCLUDE/trigger → drift & migration nguy hiểm.
- **Drizzle ORM** — *Được chấp nhận như phương án thay thế* (xem ghi chú trên).
- **TypeORM / raw `pg` thuần** — *Bác bỏ:* TypeORM yếu migration (đã loại ở `01`); raw `pg` mất type-safety toàn cục.

---

## Amendment 2026-06-10 — Baseline version

Giữ nguyên quyết định (SQL-first + Prisma typed client). Baseline cập nhật theo `01-tech-stack.md`: **Prisma 6.x**, dùng **Client Extensions** (API `$use` middleware đã deprecated — mọi cross-cutting: soft-delete filter, tenant context đều viết bằng extension). Drizzle vẫn là phương án thay thế được chấp nhận nếu team quyết trước khi viết migration đầu tiên.
