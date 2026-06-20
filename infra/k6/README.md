# Load test (k6) — task 8.3

Kịch bản đo tải API theo **performance budget** [`docs/11` §10](../../docs/11-observability-ops.md).
Cần [k6](https://k6.io) **≥ 0.59** (module SSE experimental).

| Script | Đo gì | Ghi DL? |
|---|---|---|
| [`load-test.js`](load-test.js) | 100 user duyệt (list/detail/report) + báo giá + **tạo 1000 booking** | ✅ `book` GHI |
| [`sse-soak.js`](sse-soak.js) | Giữ **500 kết nối SSE** đồng thời | ❌ chỉ đọc |

> ⚠️ **`load-test.js` có scenario `book` tạo booking thật** → chạy vào **staging /
> môi trường throwaway có seed**, TUYỆT ĐỐI không phải prod. `sse-soak.js` chỉ đọc.

## Chạy

```bash
# HTTP load (browse + quote + book)
k6 run \
  -e TARGET_URL=https://staging-api.pmsapp.vn \
  -e TENANT_SLUG=demo \
  -e LOAD_EMAIL=owner@demo.vn \
  -e LOAD_PASSWORD='…' \
  infra/k6/load-test.js

# SSE soak (500 kết nối)
k6 run -e TARGET_URL=… -e TENANT_SLUG=demo -e LOAD_EMAIL=… -e LOAD_PASSWORD=… \
  infra/k6/sse-soak.js
```

| Env | Mặc định | Ý nghĩa |
|---|---|---|
| `TARGET_URL` | `http://localhost:3001` | Base URL API (đặt **staging**) |
| `TENANT_SLUG` | `demo` | Header `X-Tenant-Slug` |
| `LOAD_EMAIL` / `LOAD_PASSWORD` | demo | Tài khoản login (cần quyền đặt phòng) |
| `BOOKINGS` | `1000` | Số booking scenario `book` tạo |
| `SSE_CONNECTIONS` / `SSE_HOLD` | `500` / `2m` | Số kết nối SSE & thời lượng giữ |

## Budget (cài thành threshold → k6 exit ≠ 0 nếu vượt)

| Loại request (tag `kind`) | p95 |
|---|---|
| `list` (GET 20 mục) | < 200ms |
| `detail` (GET chi tiết) | < 100ms |
| `quote` (POST /pricing/quote) | < 100ms |
| `report` (GET báo cáo) | < 300ms |
| `mutation` (POST tạo booking) | < 400ms |
| Lỗi (`http_req_failed`) | < 1% |

`sse-soak.js`: `sse_connection_errors` = 0.

## Lưu ý

- **Chạy vs localhost không đại diện** (1 process, không LB/CF) — chỉ để smoke. Số
  thật phải đo vs môi trường giống prod (docs/11 §10: nightly trên runner cố định).
- `book` rải mỗi iteration 1 ngày riêng (offset +400 ngày) → không đụng occupancy;
  409 `BOOKING_OVERLAP` khi tải cao được **đếm, không tính lỗi budget**.
- **SSE end-to-end < 500ms** (§10) cần test tương quan (kích mutation rồi đo event
  tới) — `sse-soak.js` đo *sức chứa kết nối*, không phải độ trễ event.
- CI: [`.github/workflows/load-test.yml`](../../.github/workflows/load-test.yml)
  (`workflow_dispatch`, gated secret `TARGET_URL`). Ghi bottleneck quan sát được
  vào runbook / issue (docs/11 §10: regression > 30% → tạo issue).
