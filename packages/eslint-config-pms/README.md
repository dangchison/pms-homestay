# @pms/eslint-config

Cấu hình **ESLint flat config** (`.mjs`) dùng chung. Ba entry point:

| Import | Dùng cho |
|---|---|
| `@pms/eslint-config` (`index.mjs`) | Base TS chung (typescript-eslint + prettier). |
| `@pms/eslint-config/react` (`react.mjs`) | Thêm rule React / react-hooks (app FE). |
| `@pms/eslint-config/tenancy` (`tenancy.mjs`) | Rule **bảo vệ multi-tenancy** cho API. |

```js
// vd apps/api/eslint.config.mjs
import base from '@pms/eslint-config';
import tenancy from '@pms/eslint-config/tenancy';
export default [...base, ...tenancy];
```

## Rule tenancy (quan trọng)

`no-restricted-syntax` **cấm `this.prisma.<model>` trong `src/modules/**`** — buộc
mọi truy cập bảng có RLS đi qua `withTenant(tx => tx.<model>)` (set GUC
`app.current_tenant_id`), chống rò dữ liệu cross-tenant.

- **Miễn trừ**: lời gọi bắt đầu `$` (vd `this.prisma.$queryRaw`,
  `$transaction`) — raw query có kiểm soát tenant tường minh.
- **Bảng GỐC** (`tenants`, `subscription_plans` — không RLS) được phép
  `this.prisma.<model>` trực tiếp kèm `// eslint-disable-next-line
  no-restricted-syntax` có lý do.
