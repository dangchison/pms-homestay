# @pms/tsconfig

Các base `tsconfig` dùng chung cho monorepo. Mỗi app/package `extends` base phù
hợp thay vì lặp lại compiler options.

```jsonc
// vd apps/api/tsconfig.json
{ "extends": "@pms/tsconfig/nestjs.json", "compilerOptions": { /* override cục bộ */ } }
```

| File | Dùng cho |
|---|---|
| `base.json` | Nền chung (strict, target, moduleResolution) — các base khác kế thừa. |
| `nestjs.json` | API NestJS (decorator metadata, CommonJS). |
| `nextjs.json` | App Next.js (jsx, bundler resolution, `noEmit`). |
| `node-library.json` | Package Node thuần (vd `pricing-engine`, `shared-types`). |
| `react-library.json` | Package React (vd `ui`). |

> Đổi quy tắc kiểu **toàn repo** → sửa `base.json`. Đổi cho riêng một loại target
> → sửa file tương ứng. Tránh override rải rác trong từng `tsconfig.json` con.
