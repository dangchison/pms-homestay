# @pms/web-staff

App vận hành tại quầy — **lễ tân** (check-in/out, thu tiền) và **buồng phòng**
(dọn phòng). **Next.js 15 + PWA**, tối ưu mobile. Cổng `:3002`.

## Chạy & verify

```bash
pnpm dev                                 # từ root
pnpm --filter @pms/web-staff dev

pnpm --filter @pms/web-staff typecheck
pnpm --filter @pms/web-staff lint
pnpm --filter @pms/web-staff build       # next build (verify; PWA chỉ bật ở prod)
```

## Cấu trúc `src/`

- **`app/`** — route App Router theo **nhóm**: `(app)` = có **bottom tabs**
  (today board, rooms board, cleaning, profile); `(flow)` = check-in/check-out
  (toàn màn, không tabs). Route trống `/offline`.
- **`components/`**, **`hooks/`**, **`lib/`** (api-client/auth/tenant/image/
  use-events — copy pattern từ web-admin), **`stores/`** (Zustand).
- **`public/sw.js`** — service worker vanilla.

## PWA & offline

- `sw.js` precache shell + **SWR** cho GET today/rooms-board/cleaning-tasks +
  nav fallback `/offline`. Đăng ký **chỉ ở production** (`ServiceWorkerRegister`
  kiểm `NODE_ENV==='production'` — tránh cache HMR khi dev).
- `OfflineBanner` + `useOnlineStatus` khoá mutation khi mất mạng.
- Manifest icon SVG 192/512 maskable + shortcuts → cài được như app.

## Luồng nghiệp vụ

- **Today board**: bucket đến / đi / đang ở (tính theo timezone property).
- **Rooms board**: phòng đang có khách (LATERAL `room_occupancy`), đổi
  housekeeping (HOUSEKEEPER chỉ `CLEANING→CLEAN`).
- **Check-in 3 bước**: camera `<input capture>` → nén canvas ≤1MB → presign →
  PUT S3 → OCR CCCD prefill → form + consent NĐ13 → lưu khách (PATCH booking
  `guest_id`, `If-Match=String(version)`) → check-in (chỉ `CONFIRMED`; `PENDING`
  → thu cọc auto-confirm / OWNER force).
- **Check-out**: FolioPanel + gate số dư = 0 (hoặc MANAGER/OWNER override).

## Tenant slug & env

Khác web-admin, login web-staff **có ô nhập tenant** → lưu `localStorage`.

| Env (`apps/web-staff/.env.local`) | Ý nghĩa |
|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL API. |
| `NEXT_PUBLIC_DEMO_MODE` | `1` → 2 nút demo (Lễ tân / Buồng phòng). TẮT khi deploy thật. |

> ⚠️ `NEXT_PUBLIC_*` nội suy lúc dev-start → **restart** `next dev` sau khi đổi.
> Verify thật nên dùng viewport mobile (vd 390×844).
