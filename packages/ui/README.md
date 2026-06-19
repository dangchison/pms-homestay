# @pms/ui

Thư viện UI dùng chung 2 app FE — component **shadcn-style** (Radix +
class-variance-authority + tailwind-merge) và **hệ design token** 2 tầng.

```ts
import { Button, Select, DatePicker, Form, toast } from '@pms/ui';
import '@pms/ui/styles.css';
```

Tiêu thụ **trực tiếp dạng source** (không build riêng): `exports` trỏ
`. → src/index.ts` và `./styles.css`. App Next transpile khi build.

## Component

`badge` · `button` · `calendar` · `card` · `checkbox` · `date-picker` · `dialog`
· `form` (wrapper react-hook-form) · `input` · `label` · `loading-screen` ·
`popover` · `section` · `select` · `separator` · `skeleton` · `sonner` ·
`sparkline` · `stat-card` · `status-badge` · `textarea`.

## Quy ước

- **Theme = CSS variable 2 tầng** (token `--<name>`, KHÔNG `--color-<name>`):
  primitive → semantic, đổi theme không cần đổi component. Recharts tô màu qua
  `fill="var(--primary)"` / `var(--booking-confirmed)`.
- **`toast`** re-export `sonner` — luôn import từ `@pms/ui` (KHÔNG từ `sonner`
  trực tiếp; sonner không phải dep của app).
- **`react-hook-form` là peerDependency OPTIONAL** (cho `form.tsx`) — app cấp.
- **`react-day-picker` pin `^9.14`** (API v9: `Chevron({orientation})`, không phải
  v8). `DateRange` re-export từ `@pms/ui` (app không import trực tiếp rdp).
- Radix Select optional → `value={x ?? ''}` (KHÔNG `undefined` — tránh warning
  uncontrolled→controlled).

```bash
pnpm --filter @pms/ui typecheck && pnpm --filter @pms/ui lint
```
