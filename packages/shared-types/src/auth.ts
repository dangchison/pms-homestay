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
  /** TOTP 6 số hoặc backup code (8 hex) khi đã bật 2FA */
  totp_code: z.string().min(6).max(16).optional(),
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

export const ForgotPasswordRequestSchema = z.object({
  email: z.email(),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  token: z.string().min(16),
  new_password: z.string().min(10),
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

export const TwoFaVerifyRequestSchema = z.object({
  totp_code: z.string().length(6).regex(/^\d{6}$/),
});
export type TwoFaVerifyRequest = z.infer<typeof TwoFaVerifyRequestSchema>;

/** Response của login/refresh — access token in-memory, refresh nằm trong cookie HTTP-only. */
export const AuthTokensResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  /** giây — access token sống 15' cố định (docs/04 §2) */
  expires_in: z.number().int(),
  /** CSRF double-submit: gửi lại qua header X-CSRF-Token ở refresh/logout */
  csrf_token: z.string(),
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    full_name: z.string(),
    role: UserRoleSchema,
  }),
});
export type AuthTokensResponse = z.infer<typeof AuthTokensResponseSchema>;

export const SessionInfoSchema = z.object({
  id: z.uuid(),
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  created_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  current: z.boolean(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
