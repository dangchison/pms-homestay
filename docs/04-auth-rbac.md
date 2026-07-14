# 04 — AUTHENTICATION & AUTHORIZATION

> **Phiên bản 3.0 (2026-06-10):** AuthZ chuyển sang **resource-based** (property scope resolve từ entity, không lấy từ params — bịt lỗ hổng bypass trong tenant); refresh rotation có **grace window** (hết logout-storm khi double-refresh); throttling nhận thức **CGNAT** của ISP Việt Nam; `scp` trong JWT chỉ còn vai trò render UI.

## 1. Tổng quan

- **AuthN:** JWT access token (15') + refresh token rotation (cookie HTTP-only).
- **AuthZ:** 3 tầng — tenant scope → property scope → action permission. **Mọi quyết định ghi/nhạy cảm kiểm tra server-side trên dữ liệu DB** (cache có version), không tin claim trong token.

## 2. JWT Strategy

### Token

| Loại | Lifetime | Lưu ở đâu | Mục đích |
|------|----------|-----------|----------|
| Access | **15 phút** (cố định, không config) | Memory (Zustand) | Gọi API |
| Refresh | **30 ngày** sliding | Cookie `HttpOnly; Secure; SameSite=Lax; Domain=.pmsapp.vn; Path=/api/v1/auth` | Lấy access mới |

### Payload access token

```json
{
  "sub": "<user_id>",
  "tnt": "<tenant_id>",
  "rol": "OWNER",
  "scp": ["prop:uuid1", "prop:uuid2"],
  "pv": 7,
  "iat": 1716470400, "exp": 1716471300,
  "jti": "<unique_token_id>", "typ": "access"
}
```

- `scp` (danh sách property của user): **CHỈ để render UI** (ẩn/hiện menu, switcher). Authorization thật luôn query server-side — token sống 15' nên claim có thể stale tới 15' sau khi quyền bị thu hồi.
- `pv` (permission version): so với `auth:pv:{user_id}` trong Redis — đổi role/quyền → bump version → access token cũ bị từ chối ngay ở guard (revocation nhanh hơn 15').
- `jti`: blacklist khi cần revoke khẩn cấp từng token.

### Refresh rotation + reuse detection + GRACE WINDOW

Mỗi refresh: cấp token mới, token cũ `revoked_at` + `rotated_to`. Token đã revoke bị dùng lại = nghi án đánh cắp → revoke cả chain. **Nhưng** mobile/mạng chập chờn hay bắn 2 refresh gần nhau — nếu xử thẳng tay sẽ logout oan cả user thật (logout-storm):

```typescript
const ROTATION_GRACE_MS = 60_000;

async refresh(presented: string) {
  const record = await this.findByHash(sha256(presented));
  if (!record || record.expiresAt < new Date()) throw new UnauthorizedException();

  if (record.revokedAt) {
    const withinGrace = Date.now() - record.revokedAt.getTime() < ROTATION_GRACE_MS;
    if (withinGrace && record.rotatedTo) {
      // Double-refresh vô hại (request song song/retry mạng):
      // trả về CHÍNH token kế nhiệm đã cấp — idempotent, không revoke chain
      return this.loadIssuedToken(record.rotatedTo);
    }
    await this.revokeAllTokensOfUser(record.userId);     // reuse THẬT → giết cả chain
    throw new SecurityException('TOKEN_REUSE_DETECTED');
  }
  return this.rotate(record);                            // happy path: cấp mới + revoke cũ (row lock)
}
```

### CSRF & cookie qua subdomain

- `POST /auth/refresh`, `/auth/logout` dùng cookie → `SameSite=Lax` chưa đủ mọi case → thêm **CSRF double-submit token**.
- API ở domain riêng (`api.pmsapp.vn`); CORS allowlist origin theo tenant subdomain + `credentials`. Cookie khai báo `Domain` tường minh.

### Endpoints

| Method | Path | Mục đích |
|--------|------|----------|
| POST | `/api/v1/auth/register` | Tạo tenant + user OWNER (trial 14 ngày) |
| POST | `/api/v1/auth/login` | Access token + set refresh cookie (bước 2FA nếu bật) |
| POST | `/api/v1/auth/refresh` | Rotate (grace window) |
| POST | `/api/v1/auth/logout` / `logout-all` | Revoke refresh hiện tại / toàn bộ |
| POST | `/api/v1/auth/forgot-password` / `reset-password` | Reset link 30' |
| POST | `/api/v1/auth/2fa/enable` / `2fa/verify` | TOTP |
| GET/DELETE | `/api/v1/auth/sessions[/:id]` | Quản lý session |

## 3. Password, 2FA & Throttling

- **Argon2id** `memoryCost=65536, timeCost=3, parallelism=4`; min 10 ký tự; check list 10k password phổ biến; KHÔNG bắt rotate định kỳ (NIST 800-63B).
- **2FA TOTP:** bắt buộc cho `OWNER` và `ACCOUNTANT` (tiền); backup codes 10 × dùng-một-lần. Secret mã hoá AES-256-GCM (ADR-0007).
- **Throttling — account-first (nhận thức CGNAT):** ISP/4G Việt Nam NAT chung IP cho rất nhiều người dùng — khoá theo IP với ngưỡng thấp sẽ khoá oan cả quán cafe/văn phòng:

| Khoá | Ngưỡng | Hành động |
|------|--------|-----------|
| Theo **account** | 5 fail / 15' | Lock account 30' (+ email cảnh báo) |
| Theo **IP** | 30 fail / 15' | Captcha (Turnstile), KHÔNG khoá cứng |
| Theo IP + UA fingerprint | 10 fail / 15' | Delay tăng dần |

  Đứng sau Cloudflare: bật trust proxy + lấy **`CF-Connecting-IP`** làm khoá (không thì mọi user chung 1 IP của CF).

## 4. Authorization model

### 3 tầng quyết định

```
1. Tenant scope     → JWT tnt khớp tenant context của request (TenantGuard)
2. Property scope   → property suy ra TỪ RESOURCE đang thao tác (không tin params/body)
3. Action permission→ role default ∪ grant ∖ deny (user_property_roles.permissions)
```

### Roles

| Role | Phạm vi | Quyền mặc định |
|------|---------|----------------|
| *(platform admin — bảng `platform_users` riêng, KHÔNG nằm trong RBAC tenant)* | Toàn platform | Quản lý tenants/plans; không xem dữ liệu nghiệp vụ |
| `OWNER` | Toàn tenant | Mọi thao tác, mời user, billing |
| `MANAGER` | Property được gán | Booking, pricing, expense; không user/billing |
| `ACCOUNTANT` | Property được gán | Invoice, payment, expense, report; không sửa booking |
| `STAFF` (lễ tân) | Property được gán | Booking, check-in/out, thu tiền, đối soát unmatched + mở/đóng ca thu ngân; không xem P&L |
| `HOUSEKEEPER` | Property được gán | Cleaning tasks; đổi housekeeping_status CLEANING→CLEAN |

### Permission matrix

| Permission | OWNER | MANAGER | ACCOUNTANT | STAFF | HOUSEKEEPER |
|------------|-------|---------|------------|-------|-------------|
| `tenant.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tenant.billing.manage` | ✓ | — | — | — | — |
| `user.invite` / `user.manage_roles` | ✓ | — | — | — | — |
| `property.create` / `property.delete` | ✓ | — | — | — | — |
| `property.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `property.update` | ✓ | ✓ | — | — | — |
| `room.crud` / `resource.crud` | ✓ | ✓ | — | — | — |
| `room.housekeeping.change` | ✓ | ✓ | — | ✓ | ✓ (chỉ CLEANING→CLEAN) |
| `rate_plan.manage` | ✓ | ✓ | — | — | — |
| `booking.read` | ✓ | ✓ | ✓ | ✓ | — |
| `booking.create/update/cancel/checkin_out/switch_resource` | ✓ | ✓ | — | ✓ (cancel cần lý do) | — |
| `invoice.read` | ✓ | ✓ | ✓ | ✓ | — |
| `invoice.create_adhoc` | ✓ | ✓ | ✓ | — | — |
| `invoice.void` | ✓ | — | ✓ | — | — |
| `payment.record` | ✓ | ✓ | ✓ | ✓ | — |
| `payment.refund` | ✓ | — | ✓ | — | — |
| `payment.reconcile` (unmatched) | ✓ | — | ✓ | ✓ | — |
| `expense.crud` | ✓ | ✓ | ✓ | — | — |
| `asset.crud` | ✓ | ✓ | — | — | — |
| `report.financial` | ✓ | ✓ | ✓ | — | — |
| `report.operational` | ✓ | ✓ | ✓ | ✓ | — |
| `channel.manage` | ✓ | ✓ | — | — | — |
| `cleaning_task.assign` | ✓ | ✓ | — | ✓ | — |
| `cleaning_task.complete` | ✓ | ✓ | — | ✓ | ✓ |
| `guest.pii.read` (xem số giấy tờ đầy đủ — audit READ_PII) | ✓ | ✓ | — | ✓ | — |
| `audit_log.read` | ✓ | — | ✓ | — | — |

### Guard — RESOLVE PROPERTY TỪ RESOURCE (không tin request shape)

Lỗ hổng của cách cũ (`req.params.propertyId ?? req.body.propertyId`): endpoint như `PATCH /bookings/:id` **không có** propertyId trong request → bước check property scope bị skip lặng lẽ → STAFF property A sửa được booking property B cùng tenant. Cách đúng — hai pha:

```typescript
// Pha 1 — PermissionsGuard (trước handler): tenant + permission theo ROLE
@Injectable()
export class PermissionsGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<Permission[]>('permissions', ctx.getHandler());
    if (!required?.length) return true;
    const { user, tenantId } = ctx.switchToHttp().getRequest();

    if (user.tnt !== tenantId) throw new ForbiddenException();
    await this.assertPermissionVersion(user);          // pv khớp Redis (revocation nhanh)
    // Mới check theo ROLE (đủ cho endpoint không gắn resource, vd list toàn tenant của OWNER)
    return required.every(p => roleHasPermission(user.rol, p));
  }
}

// Pha 2 — TRONG service, SAU khi load entity: property scope + permission override per-property
// (bắt buộc với mọi endpoint thao tác trên một resource cụ thể)
async function authorizeOnProperty(user: AuthUser, propertyId: string, perm: Permission) {
  if (user.rol === 'OWNER') return;
  const perms = await this.permissionService.effectivePermissions(user.sub, propertyId); // cache §4.6
  if (!perms.has(perm)) throw new ForbiddenException({ code: 'AUTHZ_PROPERTY_SCOPE' });
}

// bookings.service.ts
async cancel(user: AuthUser, bookingId: string, dto: CancelDto) {
  return withTenant(this.prisma, user.tnt, async (tx) => {
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } }); // RLS đã chặn cross-tenant
    await this.authorizeOnProperty(user, booking.property_id, 'booking.cancel');      // property TỪ ENTITY
    // ...
  });
}
```

**List endpoints:** filter server-side theo danh sách property user có quyền (query `user_property_roles`), không filter theo `scp` của token.

### Cache permission có version (§4.6)

`effectivePermissions(userId, propertyId)` đọc DB sẽ thành N+1 ở mọi request → cache Redis key `perm:{user}:{property}` TTL 60s; **mọi mutation** lên `user_property_roles` bump `auth:pv:{user_id}` → guard từ chối token `pv` cũ → client refresh → nhận token `pv` mới, cache nạp lại. Thu hồi quyền có hiệu lực trong giây, không phải 15 phút.

### Override granular

`user_property_roles.permissions` JSONB: `{ "grant": ["payment.refund"], "deny": ["booking.cancel"] }`. Effective = (role default ∪ grant) ∖ deny.

## 5. Audit

Mọi mutation qua `AuditInterceptor` (redact PII trước khi ghi `before/after`); đọc PII (số giấy tờ đầy đủ, export) ghi `READ_PII`. Bảng append-only — xem `03` §4.11.

## 6. Pitfalls

| Lỗi | Phòng tránh |
|-----|------------|
| Tin `scp`/claims cho quyết định ghi | Server-side check + `pv` version — claim chỉ để render UI |
| Property scope lấy từ params/body | **Resolve từ entity sau khi load** (pha 2, §4) |
| Double-refresh → logout oan | Grace window 60s trả token kế nhiệm idempotent |
| Lưu refresh token plaintext | SHA256 trước khi lưu |
| Quên revoke khi đổi password | Hook AfterPasswordChange → revoke all + bump `pv` |
| Khoá IP ngưỡng thấp sau CF/CGNAT | Account-first + `CF-Connecting-IP` + captcha thay khoá cứng |
| PLATFORM_ADMIN trộn vào `users` | Bảng `platform_users` riêng, auth riêng, 2FA bắt buộc |
| 2FA secret plaintext | AES-256-GCM, key ngoài DB (ADR-0007) |
| CSRF trên endpoint dùng cookie | Double-submit token + SameSite + domain API tách riêng |
