# @pms/shared-types

**Nguồn chân lý** cho schema dữ liệu dùng chung giữa API và 2 app FE: mỗi domain
một file `*.ts` khai báo **Zod schema** + type suy ra (`z.infer`). Dependency duy
nhất: `zod`.

```ts
import { CreateBookingRequestSchema, type CreateBookingRequest } from '@pms/shared-types';
```

## Build

```bash
pnpm --filter @pms/shared-types build    # tsup → dist (cjs + esm + .d.ts)
pnpm --filter @pms/shared-types dev      # watch
```

> ⚠️ **Phải build lại sau khi thêm/đổi type.** API import **Zod schema lúc
> RUNTIME** từ `dist/` (validate request) và FE import type từ `dist/*.d.ts`. Quên
> build → API chạy schema cũ, FE thiếu type. (CI build trước test.)

## Quy ước

- Schema `.default()` làm **input type ≠ output type** → có thể vỡ typing của
  `react-hook-form` resolver; khi cần, dùng schema cục bộ không `.default()` ở FE.
- File theo domain: `auth`, `property`, `room`, `resource`, `booking`, `guest`,
  `quote`, `rate-plan`, `invoice`, `payment`, `expense`, `asset`, `report`,
  `calendar`, `channel`, `cleaning-task`, `notification`, `audit-log`,
  `compliance`, `subscription`, `billing`, `tenant`, `user`, `events`, `common`.
  Thêm type mới → export trong `index.ts`.
