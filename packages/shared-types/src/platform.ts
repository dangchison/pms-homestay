import { z } from 'zod';

/**
 * Platform-auth (B4, docs/14 §4.7) — đăng nhập admin nền tảng (bảng `platform_users`),
 * TÁCH biệt auth tenant. Token ký bằng JWT_PLATFORM_SECRET (khác JWT_ACCESS_SECRET)
 * + claim `typ: 'platform'` → không dùng chéo được với token tenant.
 */
export const PlatformLoginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export type PlatformLoginRequest = z.infer<typeof PlatformLoginRequestSchema>;

export const PlatformLoginResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  /** giây — platform access token sống 1h, KHÔNG refresh (admin đăng nhập lại). */
  expires_in: z.number().int(),
  admin: z.object({
    id: z.uuid(),
    email: z.email(),
    full_name: z.string(),
  }),
});
export type PlatformLoginResponse = z.infer<typeof PlatformLoginResponseSchema>;

/** Claims platform access token — KHÁC JwtClaims tenant (không `tnt`; `typ` = 'platform'). */
export const PlatformClaimsSchema = z.object({
  /** platform_users.id */
  sub: z.uuid(),
  /** email admin (tiện log/audit) */
  eml: z.email(),
  typ: z.literal('platform'),
  jti: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type PlatformClaims = z.infer<typeof PlatformClaimsSchema>;
