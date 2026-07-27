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

/**
 * Mọi ràng buộc PHẢI kèm thông điệp tiếng Việt: schema này chạy ở CẢ hai phía —
 * zodResolver hiện thẳng message dưới ô nhập, và BE trả nguyên message trong
 * `error.fields[]`. Bỏ trống thì người đăng ký nhận mặc định tiếng Anh của Zod
 * ("Too small: expected string to have >=10 characters") ngay trên form tiếng Việt.
 */
export const RegisterTenantRequestSchema = z.object({
  tenant_slug: z
    .string()
    .min(2, 'Tên miền riêng tối thiểu 2 ký tự')
    .max(64, 'Tên miền riêng tối đa 64 ký tự')
    .regex(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
      'Tên miền riêng chỉ gồm chữ thường không dấu, số và dấu gạch ngang ở giữa',
    ),
  tenant_display_name: z
    .string()
    .min(1, 'Nhập tên cơ sở kinh doanh')
    .max(255, 'Tên cơ sở tối đa 255 ký tự'),
  email: z.email('Email không hợp lệ'),
  password: z.string().min(10, 'Mật khẩu tối thiểu 10 ký tự'),
  full_name: z.string().min(1, 'Nhập họ tên của bạn').max(255, 'Họ tên tối đa 255 ký tự'),
});
export type RegisterTenantRequest = z.infer<typeof RegisterTenantRequestSchema>;

export const ForgotPasswordRequestSchema = z.object({
  email: z.email('Email không hợp lệ'),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  token: z.string().min(16, 'Liên kết đặt lại mật khẩu không hợp lệ'),
  new_password: z.string().min(10, 'Mật khẩu mới tối thiểu 10 ký tự'),
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

export const TwoFaVerifyRequestSchema = z.object({
  totp_code: z.string().length(6).regex(/^\d{6}$/),
});
export type TwoFaVerifyRequest = z.infer<typeof TwoFaVerifyRequestSchema>;

/** Đổi mật khẩu khi đã đăng nhập (task 6.7 S4) — xác minh mật khẩu hiện tại. */
export const ChangePasswordRequestSchema = z.object({
  current_password: z.string().min(1, 'Nhập mật khẩu hiện tại'),
  new_password: z.string().min(10, 'Mật khẩu mới tối thiểu 10 ký tự'),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

/** Tắt 2FA (task 6.7 S4) — cần TOTP hợp lệ để chứng minh sở hữu. */
export const TwoFaDisableRequestSchema = z.object({
  totp_code: z.string().length(6).regex(/^\d{6}$/),
});
export type TwoFaDisableRequest = z.infer<typeof TwoFaDisableRequestSchema>;

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
