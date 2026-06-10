# 00 — TỔNG QUAN HỆ THỐNG PMS HOMESTAY (SaaS Multi-tenant)

> **Phiên bản:** 3.0 · **Ngày:** 2026-06-10 · **Trạng thái:** Ready for implementation
>
> Bản 3.0 đã **tích hợp toàn bộ** kết quả review kiến trúc + audit lần 2 vào thân mọi tài liệu — không còn ghi chú "khi xung đột thì…" rải rác. Lịch sử quyết định nằm ở [`adr/`](adr/); nhật ký thay đổi ở [`CHANGELOG-2026-06-review.md`](CHANGELOG-2026-06-review.md).
>
> **Thứ tự ưu tiên tài liệu (một chiều):** `adr/` > tài liệu domain `00–13` + `ui/` > `14`/`15` (view thực thi — cập nhật theo docs, không bao giờ ngược lại).

## 1. Bối cảnh sản phẩm

Hệ thống Property Management System (PMS) phục vụ chủ homestay, căn hộ dịch vụ, mô hình thuê lại cho thuê (rent-to-rent) tại Việt Nam. Triển khai theo mô hình **SaaS multi-tenant**: nhiều chủ kinh doanh (tenants) cùng dùng chung hệ thống, dữ liệu cách ly hoàn toàn ở tầng database.

**Mục tiêu MVP (3 tháng đầu):**
- Phục vụ ổn định **dưới 500 phòng** trên toàn bộ tenants.
- 3 phương thức thuê: theo giờ, theo ngày, theo tháng (gồm hoá đơn điện nước hằng tháng).
- 3 loại property: homestay, rent-to-rent, apartment; bán **từng phòng và/hoặc nguyên căn** (bookable unit — [ADR-0006](adr/0006-bookable-unit-model.md)).
- Đồng bộ 2 chiều với Airbnb/Booking/Agoda qua iCal.
- Thanh toán VietQR động + tiền mặt, **tự đối soát qua webhook Casso/SePay**.
- Báo cáo: doanh thu, chi phí, lợi nhuận, điểm hoà vốn, ADR/RevPAR/occupancy.
- Vận hành SaaS tối thiểu: trial 14 ngày, enforce hạn mức gói, thu phí tenant (billing-lite).

**Không nằm trong MVP** (giai đoạn sau):
- Channel Manager qua API (Channex/SiteMinder) — đã thiết kế webhook + dedup, chưa implement (ngoại lệ: phòng bán ≥2 OTA cân nhắc kéo lên sớm — xem `08` §6).
- Booking engine cho khách tự đặt (`web-guest`).
- Mobile native; hoá đơn điện tử (NĐ123); Momo/ZaloPay/thẻ; BI/AI dự báo.

## 2. Nguyên tắc kiến trúc

1. **Modular Monolith trước, microservices sau.** Mỗi domain là một module NestJS độc lập, giao tiếp qua interface + domain event. Khi tải đủ lớn (>10.000 phòng) mới tách service.

2. **Database là source of truth.** Mọi business invariant (không trùng booking, tổng hoá đơn, cách ly tenant) enforce ở DB bằng constraint — không phụ thuộc application logic. Chống overbooking = EXCLUDE trên `room_occupancy` ([ADR-0006](adr/0006-bookable-unit-model.md)).

3. **Multi-tenant isolation 3 lớp:** cột `tenant_id` + **RLS** (context theo interactive transaction, [ADR-0002](adr/0002-rls-tenant-context-and-pooling.md)) + **composite FK** `(tenant_id, id)` ([ADR-0005](adr/0005-tenant-isolation-composite-fk.md) — vì referential integrity bypass RLS).

4. **Transaction = unit-of-work ngắn.** `withTenant` bao quanh công việc DB; **cấm external I/O trong transaction** (ADR-0002 amendment). Mỗi sự thật chỉ có một nguồn; mỗi nghiệp vụ ghi chỉ có một đường code (vd: mọi booking đi qua `createBookingTx`).

5. **Idempotency mặc định.** Endpoint mutation quan trọng nhận `Idempotency-Key`; webhook dedup theo `event_id`; job chạy lại không sinh đôi.

6. **Event-driven nội bộ qua Transactional Outbox** (v2: claim + reclaim, LISTEN/NOTIFY — xem `10`). SSE là tín hiệu invalidation, REST là nguồn sự thật.

7. **Audit mọi thay đổi tài chính + mọi lần đọc PII.** Append-only, redact PII, partition theo tháng. PII định danh mã hoá mức field ([ADR-0007](adr/0007-pii-field-encryption.md)).

## 3. Sơ đồ kiến trúc tổng thể

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                            │
│        ┌──────────────────────┐   ┌──────────────────────┐      │
│        │ web-admin            │   │ web-staff            │      │
│        │ (Next.js dashboard,  │   │ (Next.js PWA cho     │      │
│        │  host/quản lý)       │   │  lễ tân/buồng phòng) │      │
│        └──────────┬───────────┘   └──────────┬───────────┘      │
│                   │    web-guest: PHASE 2    │                  │
└───────────────────┼──────────────────────────┼──────────────────┘
                    │  HTTPS (HTTP/2 cho SSE)  │
                    ▼                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                  API (NestJS, modular monolith)                 │
│  • JWT verify + refresh rotation (cookie HTTP-only, CSRF)       │
│  • Tenant resolution (subdomain/header → JWT claim)             │
│  • RLS context: withTenant (unit-of-work, ADR-0002)             │
│  • Rate limiting (account-first; CF-Connecting-IP)              │
│  • Request-ID, structured logging, audit interceptor            │
└─────────────────────────────────────────────────────────────────┘
        │                         │                        │
        ▼                         ▼                        ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│ DOMAIN MODULES   │  │ INTEGRATION      │  │ BACKGROUND WORKERS   │
│ (in-process)     │  │ MODULES          │  │ (BullMQ)             │
│ • iam / tenant   │  │ • payment-vietqr │  │ • outbox-dispatcher  │
│ • property/room  │  │   + casso-sepay  │  │   (LISTEN/NOTIFY)    │
│ • bookable-unit  │  │   webhook        │  │ • ical-sync          │
│   + occupancy    │  │ • ocr-fpt        │  │ • night-audit        │
│ • booking        │  │ • email-resend   │  │   (no-show, rollup,  │
│ • pricing/quotes │  │ • zns-zalo / sms │  │    billing tháng,    │
│ • invoice/payment│  │ • channel-mgr*   │  │    retention)        │
│ • expense/asset  │  │   (phase 2)      │  │ • notification       │
│ • cleaning       │  └──────────────────┘  │ • depreciation       │
│ • report         │                        └──────────────────────┘
│ • billing-lite   │                                   │
│ • notification   │                                   │
│ • audit          │                                   │
└──────────────────┘                                   │
        │                                              │
        └────────────────┬─────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DATA LAYER                                  │
│  ┌────────────────────────┐    ┌────────────────────────┐       │
│  │ PostgreSQL 16          │    │ Redis 7 (self-host     │       │
│  │  • RLS + composite FK  │    │  cạnh API trên VPS)    │       │
│  │  • room_occupancy      │    │  • BullMQ queues       │       │
│  │    EXCLUDE (gist)      │    │  • Cache (tnt: prefix) │       │
│  │  • Outbox + NOTIFY     │    │  • SSE pub/sub         │       │
│  │  • audit partition     │    │    cross-instance      │       │
│  │  • PITR: WAL/provider  │    │                        │       │
│  └────────────────────────┘    └────────────────────────┘       │
│                                                                 │
│  ┌────────────────────────┐    ┌────────────────────────┐       │
│  │ Object storage         │    │ Observability          │       │
│  │  • Ảnh phòng/PDF: R2   │    │  • Sentry (errors)     │       │
│  │  • Scan CCCD: provider │    │  • Better Stack (logs, │       │
│  │    VN (ADR-0004) +     │    │    uptime, status page)│       │
│  │    field-enc (ADR-0007)│    │  • OTel SDK (trace-    │       │
│  └────────────────────────┘    │    ready từ ngày 1)    │       │
│                                └────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

## 4. Cấu trúc tài liệu

| File | Nội dung |
|------|----------|
| `00-overview.md` | (file này) Tổng quan, nguyên tắc, sơ đồ |
| `01-tech-stack.md` | Stack chi tiết (baseline 2026-06), lý do chọn |
| `02-multi-tenancy.md` | Multi-tenant, RLS, `withTenant`, tenant lifecycle |
| `03-database-erd.md` | **Schema chung cuộc 42 bảng** + retention matrix |
| `04-auth-rbac.md` | JWT, refresh rotation (grace), RBAC resource-based |
| `05-api-conventions.md` | REST, error format, pagination, idempotency, If-Match |
| `06-overbooking-prevention.md` | 4 lớp chống overbooking quanh `room_occupancy` |
| `07-pricing-engine.md` | Rate plan theo resource, quote persist, timezone-aware |
| `08-channel-sync.md` | iCal 2 chiều theo listing/resource, sanity-guard, ETag |
| `09-finance-accounting.md` | Invoice 1:N (cọc/tháng), VietQR + Casso, night-audit, P&L |
| `10-realtime-events.md` | Outbox v2, SSE semantics, notification fan-out |
| `11-observability-ops.md` | Logging, monitoring, backup, CI/CD, secrets, retention |
| `12-vietnam-compliance.md` | Lưu trú công an, NĐ13, VietQR spec, OCR, e-invoice |
| `13-folder-structure.md` | Monorepo + NestJS + Next.js structure |
| `14-roadmap-tasks.md` | Task list cho AI coding agent (mirror của docs) |
| `15-sprint-plan.md` | Kế hoạch 6 sprint / 12 tuần |
| `16-product-roadmap.md` | Đề xuất tính năng sau MVP (25 mục, 3 wave) — wish-list đã thẩm định, không phải cam kết |
| `ui/` | **UI spec:** design system, inventory page admin/staff, key flows |
| `adr/` | 7 Architecture Decision Records |
| `CHANGELOG-2026-06-review.md` | Nhật ký audit: phát hiện → cách xử lý |

## 5. Cách AI coding agent dùng bộ tài liệu này

- **Bắt đầu:** `00` → `01` → `13` để hiểu khung; đọc toàn bộ `adr/`.
- **Implement task:** lấy task từ `14`, đọc kèm file domain liên quan. Task acceptance đã đồng bộ với docs — nếu phát hiện lệch, **docs domain + ADR thắng**, sửa `14` trước rồi mới code.
- **Viết SQL/migration:** bắt buộc theo `02` + `03` (SQL-first — [ADR-0001](adr/0001-orm-strategy.md)); mỗi bảng mới đi kèm RLS + composite FK + dòng retention.
- **Viết endpoint:** theo `05`; mọi mutation qua `withTenant` unit-of-work.
- **Build UI:** theo `ui/` (page inventory + flows) — không tự chế route/luồng mới.
- **Commit:** mỗi PR ≤ 1 task, có test, qua checklist PR trong `14`.
