import { z } from 'zod';
import { MoneyVndSchema } from './common';

export const TenantStatusSchema = z.enum(['TRIAL', 'ACTIVE', 'SUSPENDED', 'CHURNED']);
export type TenantStatus = z.infer<typeof TenantStatusSchema>;

export const SubscriptionPlanCodeSchema = z.enum(['FREE', 'STARTER', 'PRO', 'ENTERPRISE']);
export type SubscriptionPlanCode = z.infer<typeof SubscriptionPlanCodeSchema>;

export const SubscriptionPlanSchema = z.object({
  id: z.uuid(),
  code: SubscriptionPlanCodeSchema,
  max_properties: z.number().int().nonnegative(),
  /** Trần tổng phòng toàn tenant. */
  max_rooms: z.number().int().nonnegative(),
  /** Trần phòng của MỘT cơ sở — enforce độc lập với max_rooms. */
  max_rooms_per_property: z.number().int().nonnegative(),
  max_users: z.number().int().nonnegative(),
  monthly_price_vnd: MoneyVndSchema,
  features: z.record(z.string(), z.unknown()).default({}),
});
export type SubscriptionPlan = z.infer<typeof SubscriptionPlanSchema>;

export const TenantSchema = z.object({
  id: z.uuid(),
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'slug chỉ gồm a-z, 0-9 và dấu gạch ngang'),
  display_name: z.string().min(1).max(255),
  business_type: z.string().max(32).nullish(),
  status: TenantStatusSchema,
  subscription_plan_id: z.uuid().nullish(),
  trial_ends_at: z.iso.datetime().nullish(),
  timezone: z.string().default('Asia/Ho_Chi_Minh'),
  currency: z.string().length(3).default('VND'),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type Tenant = z.infer<typeof TenantSchema>;

/** PATCH /tenant (task 6.7 S1) — hồ sơ tenant (slug/status/plan read-only). */
export const UpdateTenantRequestSchema = z
  .object({
    display_name: z.string().min(1).max(255).optional(),
    business_type: z.string().max(32).nullable().optional(),
    timezone: z.string().min(1).max(64).optional(),
    currency: z.string().length(3).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Cần ít nhất một trường để cập nhật' });
export type UpdateTenantRequest = z.infer<typeof UpdateTenantRequestSchema>;
