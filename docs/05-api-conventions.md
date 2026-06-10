# 05 — API CONVENTIONS

## 1. Nguyên tắc chung

- **REST + JSON.** Không GraphQL ở MVP (tăng cost, ít cần).
- **Versioning qua URL:** `/api/v1/...`. Khi breaking change → `/api/v2/...`, hỗ trợ song song 6 tháng.
- **Naming:** Path dùng `kebab-case`, plural noun, không có verb. Filter qua query param, action đặc biệt dùng sub-resource hoặc POST.

Đúng:
```
GET    /api/v1/bookings?status=CONFIRMED&from=2026-05-01
POST   /api/v1/bookings
GET    /api/v1/bookings/{id}
PATCH  /api/v1/bookings/{id}
DELETE /api/v1/bookings/{id}
POST   /api/v1/bookings/{id}/switch-room
POST   /api/v1/bookings/{id}/cancel
POST   /api/v1/bookings/{id}/check-in
```

Sai:
```
GET  /api/v1/getBookings
POST /api/v1/booking/cancel/{id}
GET  /api/v1/bookings/list-confirmed
```

## 2. Request format

### Headers chuẩn

| Header | Bắt buộc | Mô tả |
|--------|----------|-------|
| `Authorization: Bearer <access_token>` | Có (trừ public) | JWT |
| `X-Tenant-Slug` | Không | Dùng cho dev hoặc khi không có subdomain |
| `X-Request-Id` | Không (server tự sinh nếu thiếu) | UUID để trace, echo về response |
| `Idempotency-Key` | Có với POST tạo entity quan trọng | UUID v4 |
| `If-Match: <version>` | Có với PATCH booking/invoice/room/cleaning-task | Optimistic locking; lệch → 409 `VERSION_CONFLICT` |
| `Content-Type: application/json` | Có | |
| `Accept-Language: vi,en;q=0.8` | Không | i18n |

### Pagination

Chuẩn **cursor-based** cho list lớn (bookings, audit logs), **offset-based** cho danh sách nhỏ.

Cursor-based:
```
GET /api/v1/bookings?limit=20&cursor=eyJpZCI6Ii4uLiIsImNyZWF0ZWRBdCI6IjIw...
```
Response:
```json
{
  "data": [...],
  "page_info": {
    "has_next": true,
    "next_cursor": "eyJpZCI6...",
    "limit": 20
  }
}
```

Offset-based:
```
GET /api/v1/properties?page=2&page_size=20
```
Response:
```json
{
  "data": [...],
  "page_info": {
    "page": 2,
    "page_size": 20,
    "total_items": 47,
    "total_pages": 3
  }
}
```

### Filter & Sort

- Filter qua query string trực tiếp: `?status=CONFIRMED&property_id=...&from=2026-05-01&to=2026-05-31`.
- Sort: `?sort=-created_at` (`-` = desc, không có `-` = asc), có thể nhiều cột: `?sort=-priority,created_at`.
- Free text search: `?q=keyword` (server quyết định search ở field nào).

## 3. Response format

### Success

Single:
```json
{
  "data": {
    "id": "uuid",
    "...": "..."
  },
  "meta": {
    "request_id": "uuid"
  }
}
```

List:
```json
{
  "data": [...],
  "page_info": {...},
  "meta": {
    "request_id": "uuid"
  }
}
```

### Error format (RFC 7807 Problem Details, có mở rộng)

```json
{
  "error": {
    "type": "https://docs.pmsapp.vn/errors/booking-overlap",
    "code": "BOOKING_OVERLAP",
    "title": "Phòng đã có khách đặt trong khoảng thời gian này",
    "status": 409,
    "detail": "Booking from 2026-05-23T14:00:00Z to 2026-05-25T12:00:00Z conflicts with existing booking BK-202605-0042",
    "instance": "/api/v1/bookings",
    "request_id": "uuid",
    "fields": [
      { "field": "check_in", "code": "OVERLAP_WITH_EXISTING", "message": "..." }
    ]
  }
}
```

### HTTP status code chuẩn

| Code | Khi nào |
|------|---------|
| 200 | GET / PATCH thành công |
| 201 | POST tạo resource thành công |
| 202 | Accepted (background job) |
| 204 | DELETE thành công, không body |
| 400 | Validation error (body sai schema) |
| 401 | Unauthenticated (chưa login hoặc token hết hạn) |
| 403 | Authenticated nhưng không có quyền |
| 404 | Resource không tồn tại hoặc không thuộc tenant |
| 409 | Conflict (overlap, version mismatch) |
| 410 | Resource đã bị xoá |
| 422 | Business rule violation |
| 423 | Resource locked (đang được giữ chỗ) |
| 429 | Rate limited |
| 500 | Internal error (log + alert) |
| 502/503/504 | Upstream/external service lỗi |

### Error code prefix theo domain

```
AUTH_*       — authentication
AUTHZ_*      — authorization
TENANT_*     — tenant
USER_*       — user
PROPERTY_*   — property
ROOM_*       — room
BOOKING_*    — booking (OVERLAP, INVALID_STATUS, ...)
PRICING_*    — rate plan
PAYMENT_*    — payment
INVOICE_*    — invoice
SYNC_*       — channel sync
VALIDATION_* — generic validation
SYSTEM_*     — internal
```

## 4. Idempotency

### POST tạo resource quan trọng

Mọi `POST` tạo `booking`, `payment`, `invoice` **bắt buộc** có `Idempotency-Key`. Server lưu vào bảng `idempotency_keys`:

1. Nhận request với header `Idempotency-Key: <uuid>`.
2. Hash SHA256 của body.
3. Lookup trong bảng:
   - **Không tồn tại:** Lock row (INSERT), xử lý request, lưu response, trả về.
   - **Tồn tại + cùng hash + completed:** Trả về response đã lưu.
   - **Tồn tại + khác hash:** Trả 409 `IDEMPOTENCY_KEY_REUSE_DIFFERENT_BODY`.
   - **Tồn tại + locked + chưa completed:** Trả 409 `REQUEST_IN_PROGRESS`.
4. Key expire sau 24 giờ.

```typescript
@Post('bookings')
@UseInterceptors(IdempotencyInterceptor)
async create(...) { ... }
```

## 4.5. Optimistic concurrency

PATCH các entity hay sửa đồng thời (`booking`, `invoice`, `room` status) bắt buộc gửi `If-Match: <version>`:
1. Client đọc entity → nhận `version`.
2. PATCH kèm `If-Match: <version>`.
3. Server: `UPDATE ... SET ..., version = version + 1 WHERE id = ? AND version = ?`. Nếu 0 row → **409 `VERSION_CONFLICT`** (client refetch + retry).

Tránh lost-update khi 2 nhân viên sửa cùng booking. Xem cột `version` trong `03-database-erd.md` §6.1.

## 5. Validation

- **Zod schemas** trong `packages/shared-types`, dùng cả BE và FE.
- BE: `nestjs-zod` integration để auto generate OpenAPI + auto validate.
- Mỗi field invalid trả về dạng:
  ```json
  { "field": "check_in", "code": "MUST_BE_FUTURE", "message": "..." }
  ```
- KHÔNG return raw error từ Prisma/PostgreSQL ra client.

## 6. Rate limiting

3 lớp (sử dụng `@nestjs/throttler` với Redis store):

| Scope | Limit |
|-------|-------|
| Per IP, global | 300 req/min |
| Per user (đã login), global | 600 req/min |
| Per endpoint nhạy cảm (login, payment) | 10 req/min/IP |
| Per webhook endpoint | 60 req/min/IP, có HMAC verify |

> Sau Cloudflare, IP nhìn thấy là của CF nếu không cấu hình: bật `trust proxy` + lấy `CF-Connecting-IP` làm khoá rate-limit/log. Chính sách chi tiết (account-first, captcha, CGNAT) xem `04-auth-rbac.md` §3.

Response khi rate limited:
```http
HTTP/1.1 429 Too Many Requests
Retry-After: 23
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1716470400
```

## 7. Timestamp & timezone

- Mọi `*_at` field trong request/response là **ISO 8601 UTC**: `"2026-05-23T07:30:00.000Z"`.
- Server không bao giờ trả về local time. Client convert hiển thị sang `Asia/Ho_Chi_Minh`.
- Date-only (không kèm time): `"2026-05-23"`.

## 8. ID format

- Mọi ID là UUID v4 (string 36 ký tự kèm dấu `-`).
- Booking code, invoice number là chuỗi business (`BK-202605-0001`), không phải ID — dùng để hiển thị, in hoá đơn.

## 9. OpenAPI / Swagger

- Auto generate từ Zod schemas qua `nestjs-zod`.
- Public tại `/api/docs` ở dev, `/api/internal/docs` ở prod (cần auth).
- Export JSON spec → commit vào repo dùng cho client codegen.

## 10. WebHook conventions (cho integration sau này)

Nếu PMS gọi ra ngoài (vd: notify khi có booking):
- POST với body JSON + header `X-Pms-Signature: sha256=<hmac>`.
- HMAC SHA256 với shared secret.
- Retry exponential backoff: 1m, 5m, 15m, 1h, 6h (5 lần).
- Idempotent: bao gồm `event_id` UUID để consumer dedup.

Nếu nhận webhook từ ngoài (vd: Channex):
- Verify HMAC signature trước mọi xử lý.
- Trả 2xx **ngay sau khi enqueue job**, không xử lý sync.
- Dedup theo `event_id` từ provider.

## 11. Soft delete behavior

- Áp dụng cho entity **danh mục** (`rooms`, `properties`, `guests`, `assets`, `rate_plans`...): `DELETE /api/v1/rooms/{id}` → soft delete (set `deleted_at`); partial unique cho phép tái tạo cùng định danh.
- `?hard=true` → hard delete, chỉ OWNER (hoặc platform admin), log audit; bị từ chối nếu còn bản ghi tài chính tham chiếu.
- `GET /api/v1/rooms?include_deleted=true` → trả cả deleted, chỉ role có audit permission.
- **`bookings`, `invoices`, `payments` KHÔNG có khái niệm delete** — chỉ chuyển trạng thái (`CANCELLED`/`VOID`/refund). Đây là hồ sơ tài chính, xoá là vi phạm nguyên tắc audit (xem `09` §2).

## 12. Versioning & deprecation

- Khi deprecate endpoint: thêm header `Deprecation: true` + `Sunset: <date>` + `Link: <new-url>; rel="successor-version"` vào response.
- Đăng thông báo trên changelog 90 ngày trước.

## 13. Mẫu cấu trúc Controller + DTO

```typescript
// bookings/dto/create-booking.dto.ts
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateBookingSchema = z.object({
  resource_id: z.string().uuid(),                 // bookable resource (phòng lẻ hoặc nguyên căn)
  quote_id: z.string().uuid(),                    // quote đã persist — server verify giá (07 §6)
  guest_id: z.string().uuid().optional(),
  guest_info: z.object({ /* inline guest */ }).optional(),
  mode: z.enum(['HOURLY', 'DAILY', 'MONTHLY']),
  check_in: z.string().datetime(),
  check_out: z.string().datetime(),
  adults: z.number().int().min(1).default(1),
  children: z.number().int().min(0).default(0),
  source: z.enum(['DIRECT', 'WALK_IN']).default('DIRECT'),
  notes: z.string().max(1000).optional(),
}).refine(d => new Date(d.check_out) > new Date(d.check_in), {
  message: 'check_out must be after check_in',
  path: ['check_out'],
});

export class CreateBookingDto extends createZodDto(CreateBookingSchema) {}

// bookings/bookings.controller.ts
@Controller('bookings')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class BookingsController {
  @Post()
  @RequirePermissions('booking.create')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Tạo booking mới' })
  async create(@Body() dto: CreateBookingDto, @CurrentUser() user: AuthUser) {
    return this.bookingsService.create(dto, user);
  }
}
```
