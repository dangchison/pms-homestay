# @pms/pricing-engine

Engine tính giá / báo giá **thuần** — **ZERO dependency**, toàn hàm pure → dễ
unit-test và tái dùng. API (`modules/pricing`) gọi engine này để dựng quote.

```ts
import { buildQuote, roundVnd } from '@pms/pricing-engine';
```

## Build & test

```bash
pnpm --filter @pms/pricing-engine build  # tsup → dist (cjs + esm + .d.ts)
pnpm --filter @pms/pricing-engine test   # vitest (thuần, không cần hạ tầng)
```

## Nội dung `src/`

- **`daily.ts` / `hourly.ts` / `monthly.ts`** — tính giá theo 3 kiểu lưu trú
  (đêm / giờ / thuê tháng pro-rate).
- **`rules.ts`** — quy tắc áp giá (ngày lễ, cuối tuần, override).
- **`holiday.types.ts`** — kiểu dữ liệu ngày lễ (lịch lễ VN nạp từ ngoài).
- **`builder.ts`** — dựng breakdown báo giá (line items + tổng + cọc).
- **`round.ts`** — `roundVnd` (làm tròn tiền VND — chuẩn duy nhất cho mọi nơi).
- **`dateutil.ts` / `timezone.ts`** — tính đêm/giờ theo timezone property.

> Tiền luôn là **đồng VND nguyên** (không phần lẻ). Mọi làm tròn đi qua `roundVnd`
> để tránh lệch khi cộng dồn line item.
