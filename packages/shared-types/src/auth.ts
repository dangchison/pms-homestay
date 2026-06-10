import { z } from 'zod';

export const UserRoleSchema = z.enum(['OWNER', 'MANAGER', 'STAFF', 'HOUSEKEEPER', 'ACCOUNTANT']);
export type UserRole = z.infer<typeof UserRoleSchema>;

/** Claims của access token (docs/04 §JWT). */
export const JwtClaimsSchema = z.object({
  /** user id */
  sub: z.uuid(),
  /** tenant id — nguồn sự thật resolve tenant sau đăng nhập */
  tnt: z.uuid(),
  /** role mặc định */
  rol: UserRoleSchema,
  /** scope property (chỉ phục vụ UI; authorize thật đọc DB) */
  scp: z.array(z.string()).default([]),
  /** permission version — so với Redis auth:pv:{user_id} để thu hồi tức thì */
  pv: z.number().int().nonnegative(),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string(),
  typ: z.enum(['access', 'refresh']),
});
export type JwtClaims = z.infer<typeof JwtClaimsSchema>;

// ── Request schemas (auth endpoints — implement ở task 1.7) ─────────────────

export const LoginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(10, 'Mật khẩu tối thiểu 10 ký tự'),
  totp_code: z.string().length(6).optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RegisterTenantRequestSchema = z.object({
  tenant_slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  tenant_display_name: z.string().min(1).max(255),
  email: z.email(),
  password: z.string().min(10),
  full_name: z.string().min(1).max(255),
});
export type RegisterTenantRequest = z.infer<typeof RegisterTenantRequestSchema>;
