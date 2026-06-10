# 01 — TECH STACK CHI TIẾT

> **Baseline 2026-06.** Nguyên tắc chọn version cho dự án greenfield: **major hiện hành + LTS còn dài hạn** — khởi đầu trên thế hệ cũ là nhận nợ kỹ thuật từ ngày 0. (Bản cũ pin Node 20 — đã **EOL 2026-04**, trước cả ngày viết tài liệu này.)

## 1. Quyết định công nghệ và lý do

### Backend

| Lớp | Lựa chọn | Version | Lý do / Ghi chú |
|-----|----------|---------|------------------|
| Runtime | Node.js | **22.x LTS** | Maintenance tới 2027-04; Node 20 đã EOL 04/2026 |
| Framework | NestJS | **^11** | DI, modular; Nest 11 chạy **Express 5** |
| Ngôn ngữ | TypeScript | **^5.8** | Strict mode bắt buộc |
| ORM | **Prisma (typed client only)** | **^6** | SQL-first migrations là nguồn sự thật — [ADR-0001](adr/0001-orm-strategy.md); cross-cutting bằng **Client Extensions** (API `$use` middleware đã deprecated) |
| Migration | `node-pg-migrate` hoặc `dbmate` | latest | SQL tay 100% (RLS, EXCLUDE, trigger, partition) |
| Validation | **Zod** (+ `nestjs-zod`) | **^4** | **Một stack validation duy nhất** — dùng chung BE/FE qua `shared-types`, auto OpenAPI. KHÔNG dùng class-validator/class-transformer song song |
| Auth | `@nestjs/jwt`, `argon2` | argon2 ≥ 0.41 | argon2id (OWASP) |
| Queue | **BullMQ** | **^5** | Redis-based; retry/delay/cron |
| Realtime | **SSE** (built-in) | — | Push 1 chiều; lý do §5 |
| HTTP client | **fetch/undici** (native) | — | Interceptor/retry viết mỏng quanh fetch; không thêm axios cho nhu cầu hiện tại |
| Cache | `cache-manager` + Redis store | ^5/^6 | API chuẩn NestJS |
| Env validation | `zod` | ^4 | Fail-fast khi thiếu env |
| Logger | `pino` + `nestjs-pino` | ^9 / ^4 | JSON structured; redact PII (xem `11` §2) |
| Observability | `@opentelemetry/sdk-node` | latest | **Gắn từ ngày 1** (auto-instr HTTP/PG/Redis) — gắn sau đắt hơn nhiều; exporter bật ở phase 2 |
| Test | `vitest` + `supertest` | **^3** | Validate `emitDecoratorMetadata`/DI metadata với NestJS ngay tuần 1; fallback `@swc` nếu vướng |
| iCal | `node-ical` | ^0.18+ | Parse; build feed bằng `ical-generator` |

### Frontend

| App | Stack | Lý do |
|-----|-------|-------|
| `web-admin` | **Next.js 15 (App Router) + React 19** + TailwindCSS **v4** + shadcn/ui (từ `packages/ui`) + TanStack Query v5 + Zustand + react-hook-form + Zod 4 | Dashboard SPA-like |
| `web-staff` | Next.js 15 PWA (Workbox) + cùng bộ trên | App lễ tân/buồng phòng; offline **read-cache** (mutation cần mạng — xem `13` §4) |
| `web-guest` | **PHASE 2 — không build ở MVP** | Booking engine cho khách tự đặt |

**Thư viện UI theo bài toán (đã chốt — chi tiết & lý do: [`ui/00`](ui/00-ui-overview.md) §4.5):** TanStack Table v8 (bảng dữ liệu) · **calendar timeline TỰ DỰNG** (CSS Grid + TanStack Virtual + dnd-kit) · dnd-kit (kéo-thả) · Recharts (charts) · lucide-react (icons) · sonner (toast).

**Lý do giữ Next.js cho cả hai app:** 1 framework, share `packages/ui` + `shared-types`, middleware multi-tenant subdomain tốt.

### Database & Cache

| Hệ | Version | Vai trò |
|----|---------|---------|
| PostgreSQL | **16.x** | Primary DB. Extension: `btree_gist` (EXCLUDE), `pg_trgm` (search), `citext`, `pgcrypto`. **Không cần `uuid-ossp`** — dùng `gen_random_uuid()` native |
| Redis | **7.x, self-host trên VPS** (container cạnh API) | BullMQ + cache + SSE pub/sub. **Không dùng Upstash cho BullMQ** — BullMQ poll liên tục, per-request pricing thành bẫy chi phí; serverless Redis chỉ hợp cache thuần |
| Object storage | Cloudflare R2 (ảnh, PDF) + **provider VN cho scan giấy tờ** | Phân tầng residency — [ADR-0004](adr/0004-data-residency.md) |

### Infrastructure (MVP)

- **Deploy:** Single VPS (Hetzner CPX31 / tương đương 4vCPU 8GB) chạy Docker Compose: api, web-admin, web-staff, redis, (postgres nếu self-host). PG data/WAL tách volume.
- **PostgreSQL:** 2 phương án, chốt cùng [ADR-0004](adr/0004-data-residency.md):
  - (A) Managed có region phù hợp residency (ưu tiên provider VN: VNG/Viettel/FPT/CMC) — PITR do provider.
  - (B) Self-host trên VPS + `pgBackRest` WAL archiving (xem `11` §6).
  - Pooler bắt buộc **tương thích interactive transaction** (RLS context — ADR-0002): PgBouncer transaction-mode (`?pgbouncer=true` cho Prisma) hoặc pooler của provider.
- **CDN + DNS:** Cloudflare (bật **HTTP/2/3** — SSE cần; lấy `CF-Connecting-IP` cho rate-limit).
- **CI/CD:** GitHub Actions. **Secrets:** Doppler. 
- Vượt ngưỡng MVP → ECS Fargate/K3s + RDS/managed PG + ElastiCache (kế hoạch, không làm trước).

### Observability (2 vendor, vai trò rõ)

| Vendor | Vai trò |
|--------|---------|
| **Sentry** | Errors FE + BE, release tracking |
| **Better Stack** | Logs (ship từ pino), dashboards/alerts trên log-metrics, uptime check, status page |

> Gọn hơn bản cũ (Sentry + Axiom + Better Stack + Grafana Cloud + UptimeRobot — 5 vendor chồng vai trò). Prometheus/Grafana self-host cân nhắc ở phase 2 khi cần metrics chuyên sâu; OTel SDK đã sẵn để xuất.

## 2. Monorepo structure

**pnpm workspaces + Turborepo:**

```
pms-homestay/
├── apps/
│   ├── api/                  # NestJS backend
│   ├── web-admin/            # Next.js dashboard
│   └── web-staff/            # Next.js PWA nhân viên
│   # web-guest: PHASE 2 — không scaffold ở MVP (tránh app chết)
├── packages/
│   ├── ui/                   # shadcn components — NGUỒN DUY NHẤT (app không giữ bản copy riêng)
│   ├── shared-types/         # Zod schemas + TS types (BE validate, FE form)
│   ├── pricing-engine/       # Pure functions + roundVnd()
│   ├── eslint-config/        # ESLint 9 flat config
│   └── tsconfig/
├── infra/
│   ├── docker/
│   ├── github-actions/
│   └── migrations-sql/       # SQL migrations — NGUỒN SỰ THẬT schema (ADR-0001)
├── docs/                     # Bộ tài liệu này
└── package.json
```

## 3. Quy ước version & dependency

- `pnpm-lock.yaml` bắt buộc commit. Renovate Bot: auto-merge patch/minor của devDependencies; major + prod deps review tay.
- Security: `pnpm audit` + Snyk + **gitleaks** (secret scan) trong CI.
- `.nvmrc` = 22. Nâng major runtime/framework = 1 task riêng có test đầy đủ, không "tiện tay".

## 4. Cấu hình ngôn ngữ và thời gian

- **Server TZ:** luôn `UTC`. **DB:** `TIMESTAMPTZ` (không bao giờ `TIMESTAMP`).
- **Pricing & hiển thị:** convert theo `properties.timezone` (`Asia/Ho_Chi_Minh`) bằng `date-fns-tz` — phép "rơi vào ngày nào" **bắt buộc** tính theo TZ property (xem `07` §4).
- **Tiền:** `BIGINT` VND; format `Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' })`; làm tròn duy nhất qua `roundVnd()`.
- **Locale:** `vi-VN` mặc định (next-intl), cấu trúc sẵn `en`.

## 5. Vì sao SSE thay vì Socket.io

| Tiêu chí | SSE | Socket.io |
|---------|-----|-----------|
| Use case (server push 1 chiều) | ✓ | thừa khả năng |
| Auto-reconnect | Browser native | Có |
| Scale ngang | Redis pub/sub (1 subscriber/instance — `10` §4) | Redis adapter |
| Proxy/LB | HTTP thuần (cần **HTTP/2** để khỏi đói connection) | Cần config riêng |
| Code | Thấp | Trung bình |

Cần bidirectional sau này (chat, collab editing) → thêm WebSocket cho riêng feature đó.

## 6. Các lựa chọn đã loại (tóm tắt)

| Vấn đề | Đã chọn | Loại | Lý do |
|--------|---------|------|-------|
| ORM | Prisma 6 (client) + SQL-first | TypeORM / Prisma-migrate-as-truth | Drift với RLS/EXCLUDE/trigger ([ADR-0001](adr/0001-orm-strategy.md)); Drizzle là alternative được chấp nhận |
| Validation | Zod duy nhất | class-validator + class-transformer | Hai stack validation song song = double work + lệch rule |
| Queue | BullMQ + Redis self-host | RabbitMQ / Upstash | RabbitMQ thừa cho MVP; Upstash đắt với poll model |
| UUID | `gen_random_uuid()` | `uuid-ossp` | Native từ PG13 |
| Khoá giữ chỗ | DB constraint (occupancy) | Redlock/Redis lock | Redis crash mất hold; DB không biết về Redis (xem `06`) |
| Logger | Pino | Winston | Nhanh, JSON-first |
| Hash | Argon2id | bcrypt | OWASP hiện hành |
| FE state | Zustand + TanStack Query | Redux Toolkit | Ít boilerplate |
| HTTP client | fetch/undici | axios | Native đủ; bớt dependency |
| Calendar timeline | Tự dựng (Grid + TanStack Virtual + dnd-kit) | FullCalendar Premium / Bryntum | License đắt, vẫn phải custom hourly/buffer/WHOLE-span (`ui/00` §4.5) |
| Mockup tool | `docs/ui/` là nguồn sự thật duy nhất | Google Stitch / v0 / Figma-AI | Output không map vào shadcn/Next; nguồn sự thật thứ hai gây drift |
