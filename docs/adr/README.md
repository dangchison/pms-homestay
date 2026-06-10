# Architecture Decision Records (ADR)

Các quyết định kiến trúc lớn của PMS Homestay. Mỗi ADR là bất biến sau khi `Accepted`;
muốn đổi → tạo ADR mới `Supersedes`, hoặc bổ sung mục **Amendment** có ngày (không sửa nội dung gốc).

| ADR | Quyết định | Trạng thái | Nguồn |
|-----|-----------|-----------|-------|
| [0001](0001-orm-strategy.md) | ORM & quản lý schema: SQL-first migrations + Prisma as typed client | Accepted *(amended 2026-06-10: Prisma 6, Client Extensions)* | review E1 / B5 |
| [0002](0002-rls-tenant-context-and-pooling.md) | RLS tenant context theo interactive transaction + chiến lược pooling | Accepted *(amended 2026-06-10: unit-of-work, cấm external I/O trong tx)* | review E2 / A1 · audit A2 |
| [0003](0003-financial-ledger.md) | Tầng tài chính: công thức paid đúng + tiến tới immutable ledger | Accepted *(amended 2026-06-10: invoice kind, deposit, 1:N, commission)* | review E3 / A5 · audit A3 |
| [0004](0004-data-residency.md) | Data residency phân tầng (PII nhạy cảm tại VN) | Proposed | review E4 / B2 |
| [0005](0005-tenant-isolation-composite-fk.md) | Tenant isolation bằng composite FK `(tenant_id, id)` | Accepted | review E5 / A2 |
| [0006](0006-bookable-unit-model.md) | Mô hình bookable unit + room_occupancy chống overbook chéo | Accepted *(amended 2026-06-10: presence-based, một cơ chế duy nhất)* | review E6 / B1 · audit D1 |
| [0007](0007-pii-field-encryption.md) | Mã hoá PII mức field + blind index tìm kiếm | Accepted | audit A8 |

> Các quyết định A1/A2/A4/A5/A6 đã được kiểm chứng bằng test chạy thật trên PostgreSQL 16 (hành vi RLS, RI bypass RLS, `FOR UPDATE SKIP LOCKED`, generated column, partial unique index).
>
> **Thứ tự ưu tiên tài liệu (một chiều, không vòng lặp):** `adr/` > tài liệu domain `00–13` > `14-roadmap-tasks.md` / `15-sprint-plan.md` (hai file sau là *view thực thi*, phải được cập nhật theo docs, không bao giờ ngược lại). Bản đồng bộ 2026-06-10 đã tích hợp toàn bộ ADR + audit vào thân mọi tài liệu — xem [`../CHANGELOG-2026-06-review.md`](../CHANGELOG-2026-06-review.md).
