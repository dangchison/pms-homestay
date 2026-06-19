# @pms/web-admin

Dashboard quản trị (chủ nhà / quản lý / kế toán) — **Next.js 15 App Router**,
React 19, TanStack Query, Zustand. Cổng `:3000`.

## Chạy & verify

```bash
pnpm dev                                 # từ root (cùng api + web-staff)
pnpm --filter @pms/web-admin dev         # chỉ app này

# Verify = typecheck + lint + build (CHƯA có e2e — runtime cần full stack)
pnpm --filter @pms/web-admin typecheck
pnpm --filter @pms/web-admin lint
pnpm --filter @pms/web-admin build       # next build
```

## Cấu trúc `src/`

- **`app/`** — route App Router. Nhóm `(dashboard)` bọc `AuthGate`; các trang:
  calendar, bookings, invoices, payments/unmatched, reports, settings/*.
- **`components/`** — theo domain (calendar, invoices, settings…) + auth.
- **`lib/`** — `api-client` (Bearer + `X-Tenant-Slug` + refresh-lock), `auth`,
  `tenant`, hooks `use-*` (react-query), `use-events` (SSE), format/datetime.
- **`stores/`** — Zustand (auth, property, locale, realtime).
- **`middleware.ts`** — KHÔNG auth-redirect (cookie refresh scoped `/api/v1/auth`
  → middleware không thấy); gate ở client qua `AuthGate`.

## Auth & realtime

- **Client-side gate.** `AuthGate` bootstrap (thử refresh khi mở app) →
  `unauthenticated` redirect `/login`. Token access giữ **in-memory** (store);
  refresh cookie HttpOnly.
- **api-client**: gắn `Authorization: Bearer` + `X-Tenant-Slug` + `X-Request-Id`.
  401 (path ≠ `/auth/`) → **1 refresh dùng chung** (module lock) → retry 1 lần.
  CSRF **double-submit** (`X-CSRF-Token`).
- **Realtime**: `EventSource('/events/stream?access_token=…')` → invalidate
  query theo prefix loại sự kiện; reconnect → refetch.
- **Tải file có auth** = `apiClient.getBlob()` → `createObjectURL` → `a.download`
  (KHÔNG `<a href>` vì cần Bearer; áp dụng xlsx police-report, zip export…).

## Tenant slug & env

web-admin **không có ô nhập tenant** ở login → slug lấy từ **subdomain**
(`demo.pmsapp.vn` → `demo`) hoặc env khi chạy localhost.

| Env (`apps/web-admin/.env.local`) | Ý nghĩa |
|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL API (vd `http://localhost:3001`). |
| `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` | Slug fallback khi localhost (vd `demo`). Thiếu → `TENANT_CONTEXT_MISSING`. |
| `NEXT_PUBLIC_DEMO_MODE` | `1` → nút "Dùng thử demo" auto-login `owner@demo.vn`. TẮT khi deploy tenant thật. |

> ⚠️ Next đọc env từ **thư mục app** (`apps/web-admin/.env.local`), KHÔNG phải
> `.env` root. `NEXT_PUBLIC_*` nội suy lúc build/dev-start → **phải restart**
> `next dev` sau khi đổi.

UI dùng **`@pms/ui`** (shadcn-style: Select/Popover/DatePicker/Form…). Toast
import từ `@pms/ui` (KHÔNG từ `sonner`). Calendar tự dựng (CSS Grid + TanStack
Virtual + dnd-kit); Reports dùng Recharts (màu qua CSS var token).
