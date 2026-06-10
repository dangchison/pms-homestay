# ADR-0005 — Tenant isolation bằng composite FK `(tenant_id, id)`

- **Status:** Accepted
- **Ngày:** 2026-06-09
- **Liên quan:** review §E5, §A2; [ADR-0002](0002-rls-tenant-context-and-pooling.md)

## Context

PostgreSQL quy định **referential-integrity checks (FK, UNIQUE, PK) luôn bypass Row-Level Security** để bảo toàn tính toàn vẹn. Hệ quả (đã kiểm chứng trên PostgreSQL 16): với FK đơn `room_id REFERENCES rooms(id)`, tenant A có thể tạo booking trỏ tới phòng của tenant B **dù RLS đã giấu phòng đó khỏi SELECT của A**. RLS một mình **không** bịt được lỗ hổng tham chiếu chéo tenant.

## Decision

**Mọi quan hệ tenant-scoped dùng composite FK kèm `tenant_id`:**

```sql
-- parent
ALTER TABLE rooms ADD CONSTRAINT uq_rooms_tenant_id UNIQUE (tenant_id, id);

-- child
ALTER TABLE bookings
  ADD CONSTRAINT fk_bookings_room
  FOREIGN KEY (tenant_id, room_id) REFERENCES rooms (tenant_id, id);
```

Áp dụng đồng loạt cho toàn bộ FK tenant-scoped, ví dụ:
`bookings → rooms / guests / rate_plans / properties`,
`invoices → bookings`, `invoice_items → invoices`, `payments → invoices`,
`rate_plan_rooms → rate_plans / rooms`, `cleaning_tasks → rooms / bookings`, …

Bổ sung vào **checklist PR** (`14-roadmap-tasks.md`): "Mọi FK tenant-scoped là composite `(tenant_id, …)`; parent có `UNIQUE (tenant_id, id)`."

## Consequences

**Tích cực**
- Isolation **xác định ở tầng DB**, không phụ thuộc code hay RLS đang bật/đúng (đã kiểm chứng: insert chéo bị từ chối).
- Bảo vệ cả khi RLS bị tắt nhầm hoặc job dùng role `BYPASSRLS`.

**Tiêu cực / chi phí**
- Mỗi parent cần thêm `UNIQUE (tenant_id, id)` (thêm index — chấp nhận được; nhiều query vốn đã lọc theo `tenant_id`).
- FK dài dòng hơn; với Prisma introspected client cần khai báo quan hệ qua các trường `(tenant_id, x_id)` — khả thi.
- Cột `tenant_id` phải hiện diện ở mọi bảng con (vốn đã là quy ước ở `02`/`03`).

## Alternatives considered

- **Chỉ RLS** — *Bác bỏ:* đã kiểm chứng là không đủ (RI bypass RLS).
- **Trigger `BEFORE INSERT/UPDATE` kiểm tra `tenant_id` của hàng cha khớp** — *Bác bỏ:* chậm hơn, dễ quên ở bảng mới, không phải ràng buộc khai báo.
