import { z } from 'zod';
import {
  SubscriptionPaymentResponseSchema,
  SubscriptionPaymentStatusSchema,
  SubscriptionUsageSchema,
} from './subscription';
import { SubscriptionPlanCodeSchema, SubscriptionPlanSchema, TenantStatusSchema } from './tenant';

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

// ── Cấu hình gói (web-platform) ──────────────────────────────────────────────

/** Body tạo/sửa gói. PATCH nhận từng phần; POST bắt buộc đủ (xem CreatePlanSchema). */
export const PlanLimitsSchema = z.object({
  name: z.string().min(1).max(128),
  max_properties: z.number().int().nonnegative(),
  max_rooms: z.number().int().nonnegative(),
  max_rooms_per_property: z.number().int().nonnegative(),
  max_users: z.number().int().nonnegative(),
  /** 0 = "liên hệ báo giá" ở gói trả phí, hoặc miễn phí ở gói FREE. */
  monthly_price_vnd: z.number().int().nonnegative(),
  features: z.record(z.string(), z.boolean()),
});

export const CreatePlatformPlanRequestSchema = PlanLimitsSchema.extend({
  code: SubscriptionPlanCodeSchema,
});
export type CreatePlatformPlanRequest = z.infer<typeof CreatePlatformPlanRequestSchema>;

/** `code` KHÔNG sửa được: tenant, seed và enum FE đều neo theo mã. */
export const UpdatePlatformPlanRequestSchema = PlanLimitsSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'Cần ít nhất một trường để cập nhật' },
);
export type UpdatePlatformPlanRequest = z.infer<typeof UpdatePlatformPlanRequestSchema>;

/** Gói kèm số tenant đang dùng — chặn sửa/xoá mù quáng. */
export const PlatformPlanSchema = SubscriptionPlanSchema.extend({
  name: z.string(),
  tenant_count: z.number().int().nonnegative(),
});
export type PlatformPlan = z.infer<typeof PlatformPlanSchema>;

// ── Danh sách tenant (web-platform) ──────────────────────────────────────────

export const PlatformTenantSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  display_name: z.string(),
  status: TenantStatusSchema,
  plan_code: SubscriptionPlanCodeSchema.nullable(),
  trial_ends_at: z.iso.datetime().nullable(),
  current_period_end: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
});
export type PlatformTenant = z.infer<typeof PlatformTenantSchema>;

/**
 * Chi tiết một tenant — có usage thật. Danh sách KHÔNG kèm usage: bảng
 * properties/rooms/users có RLS, đếm chéo tenant phải mở một transaction có set
 * `app.current_tenant_id` cho từng tenant.
 */
export const PlatformTenantDetailSchema = PlatformTenantSchema.extend({
  usage: SubscriptionUsageSchema,
  plan: SubscriptionPlanSchema.nullable(),
});
export type PlatformTenantDetail = z.infer<typeof PlatformTenantDetailSchema>;

export const PlatformTenantListQuerySchema = z.object({
  q: z.string().trim().min(1).max(64).optional(),
  status: TenantStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type PlatformTenantListQuery = z.infer<typeof PlatformTenantListQuerySchema>;

/** Đổi gói và/hoặc trạng thái tenant bằng tay (hỗ trợ khách, sửa sai sót). */
export const UpdatePlatformTenantRequestSchema = z
  .object({
    plan_code: SubscriptionPlanCodeSchema.optional(),
    /** Chỉ cho phép hai chiều an toàn; CHURNED là việc của cron. */
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Cần ít nhất một trường để cập nhật' });
export type UpdatePlatformTenantRequest = z.infer<typeof UpdatePlatformTenantRequestSchema>;

// ── Thanh toán thuê bao chờ xác nhận (web-platform) ──────────────────────────

export const PlatformPaymentListQuerySchema = z.object({
  status: SubscriptionPaymentStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PlatformPaymentListQuery = z.infer<typeof PlatformPaymentListQuerySchema>;

/** Payment kèm tenant để admin biết đang xác nhận cho ai. */
export const PlatformPaymentSchema = SubscriptionPaymentResponseSchema.extend({
  tenant_id: z.uuid(),
  tenant_slug: z.string(),
  tenant_display_name: z.string(),
});
export type PlatformPayment = z.infer<typeof PlatformPaymentSchema>;
