import { z } from 'zod';

export const BookingModeSchema = z.enum(['HOURLY', 'DAILY', 'MONTHLY']);
export type BookingMode = z.infer<typeof BookingModeSchema>;

export const DepositTypeSchema = z.enum(['NONE', 'FIXED', 'PERCENT']);
export type DepositType = z.infer<typeof DepositTypeSchema>;

export const RatePlanRuleTypeSchema = z.enum([
  'WEEKDAY',
  'WEEKEND',
  'HOLIDAY',
  'SEASON',
  'DATE_RANGE',
]);
export type RatePlanRuleType = z.infer<typeof RatePlanRuleTypeSchema>;

export const PriceModifierTypeSchema = z.enum(['FIXED', 'PERCENT', 'OVERRIDE']);
export type PriceModifierType = z.infer<typeof PriceModifierTypeSchema>;

/** Giờ trong ngày 'HH:mm' (cột TIME). */
const TimeStringSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Định dạng HH:mm');
const moneyOpt = z.number().int().nonnegative().optional();

/** Trường giá dùng chung create/update (base_price required khi create, override optional khi update). */
const pricingFields = {
  base_price_vnd: z.number().int().nonnegative(),
  deposit_type: DepositTypeSchema.optional(),
  deposit_value: z.number().int().nonnegative().optional(),
  hourly_base_hours: z.number().int().positive().optional(),
  hourly_extra_block_minutes: z.number().int().positive().optional(),
  hourly_extra_block_price_vnd: moneyOpt,
  hourly_overnight_surcharge_vnd: moneyOpt,
  hourly_overnight_start: TimeStringSchema.optional(),
  hourly_overnight_end: TimeStringSchema.optional(),
  daily_checkin_time: TimeStringSchema.optional(),
  daily_checkout_time: TimeStringSchema.optional(),
  daily_early_checkin_fee_vnd: moneyOpt,
  daily_late_checkout_fee_vnd: moneyOpt,
  monthly_includes_utilities: z.boolean().optional(),
  monthly_electricity_per_kwh_vnd: moneyOpt,
  monthly_water_per_m3_vnd: moneyOpt,
} as const;

/** Cọc PERCENT dùng basis point (0..10000 = 0..100%). */
const depositRefine = (d: { deposit_type?: DepositType; deposit_value?: number }): boolean =>
  d.deposit_type !== 'PERCENT' || d.deposit_value == null || (d.deposit_value >= 0 && d.deposit_value <= 10000);
const DEPOSIT_MSG = { message: 'deposit_value PERCENT theo basis point 0..10000 (3000 = 30%)', path: ['deposit_value'] };

export const CreateRatePlanRequestSchema = z
  .object({
    property_id: z.uuid(),
    name: z.string().min(1).max(255),
    mode: BookingModeSchema,
    is_default: z.boolean().optional(),
    effective_from: z.iso.date(),
    effective_to: z.iso.date().optional(),
    resource_ids: z.array(z.uuid()).optional(), // gán resource ngay khi tạo (tuỳ chọn)
    ...pricingFields,
  })
  .refine((d) => !d.effective_to || d.effective_to > d.effective_from, {
    message: 'effective_to phải sau effective_from',
    path: ['effective_to'],
  })
  .refine(depositRefine, DEPOSIT_MSG);
export type CreateRatePlanRequest = z.infer<typeof CreateRatePlanRequestSchema>;

export const UpdateRatePlanRequestSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    is_default: z.boolean().optional(),
    is_active: z.boolean().optional(),
    effective_from: z.iso.date().optional(),
    effective_to: z.iso.date().nullable().optional(),
    ...pricingFields,
    base_price_vnd: z.number().int().nonnegative().optional(), // optional khi update
  })
  .refine(depositRefine, DEPOSIT_MSG);
export type UpdateRatePlanRequest = z.infer<typeof UpdateRatePlanRequestSchema>;

/** Gán/cập nhật danh sách resource cho plan (rỗng = gỡ hết). */
export const AssignRatePlanResourcesRequestSchema = z.object({
  resource_ids: z.array(z.uuid()),
});
export type AssignRatePlanResourcesRequest = z.infer<typeof AssignRatePlanResourcesRequestSchema>;

// ── Rules ────────────────────────────────────────────────────────────────────

const ruleFields = {
  rule_type: RatePlanRuleTypeSchema,
  start_date: z.iso.date().optional(),
  end_date: z.iso.date().optional(),
  days_of_week: z.array(z.number().int().min(0).max(6)).optional(), // 0=CN..6=T7
  price_modifier_type: PriceModifierTypeSchema,
  price_modifier_value: z.number().int(), // FIXED/PERCENT có thể âm; OVERRIDE >= 0
  priority: z.number().int().optional(),
  notes: z.string().max(255).optional(),
} as const;

const ruleDateRefine = (d: { start_date?: string | null; end_date?: string | null }): boolean =>
  !d.start_date || !d.end_date || d.end_date >= d.start_date;
const overrideRefine = (d: { price_modifier_type?: PriceModifierType; price_modifier_value?: number }): boolean =>
  d.price_modifier_type !== 'OVERRIDE' || d.price_modifier_value == null || d.price_modifier_value >= 0;
const RULE_DATE_MSG = { message: 'end_date phải >= start_date', path: ['end_date'] };
const OVERRIDE_MSG = { message: 'OVERRIDE cần giá >= 0', path: ['price_modifier_value'] };

export const CreateRatePlanRuleRequestSchema = z
  .object(ruleFields)
  .refine(ruleDateRefine, RULE_DATE_MSG)
  .refine(overrideRefine, OVERRIDE_MSG);
export type CreateRatePlanRuleRequest = z.infer<typeof CreateRatePlanRuleRequestSchema>;

export const UpdateRatePlanRuleRequestSchema = z
  .object({
    rule_type: RatePlanRuleTypeSchema.optional(),
    start_date: z.iso.date().nullable().optional(),
    end_date: z.iso.date().nullable().optional(),
    days_of_week: z.array(z.number().int().min(0).max(6)).nullable().optional(),
    price_modifier_type: PriceModifierTypeSchema.optional(),
    price_modifier_value: z.number().int().optional(),
    priority: z.number().int().optional(),
    notes: z.string().max(255).nullable().optional(),
  })
  .refine(ruleDateRefine, RULE_DATE_MSG)
  .refine(overrideRefine, OVERRIDE_MSG);
export type UpdateRatePlanRuleRequest = z.infer<typeof UpdateRatePlanRuleRequestSchema>;

// ── Responses ────────────────────────────────────────────────────────────────

export const RatePlanRuleResponseSchema = z.object({
  id: z.uuid(),
  rate_plan_id: z.uuid(),
  rule_type: RatePlanRuleTypeSchema,
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  days_of_week: z.array(z.number().int()).nullable(),
  price_modifier_type: PriceModifierTypeSchema,
  price_modifier_value: z.number().int(),
  priority: z.number().int(),
  notes: z.string().nullable(),
  created_at: z.iso.datetime(),
});
export type RatePlanRuleResponse = z.infer<typeof RatePlanRuleResponseSchema>;

export const RatePlanResponseSchema = z.object({
  id: z.uuid(),
  property_id: z.uuid(),
  name: z.string(),
  mode: BookingModeSchema,
  is_default: z.boolean(),
  is_active: z.boolean(),
  version: z.number().int(),
  base_price_vnd: z.number().int(),
  deposit_type: DepositTypeSchema,
  deposit_value: z.number().int(),
  hourly_base_hours: z.number().int().nullable(),
  hourly_extra_block_minutes: z.number().int().nullable(),
  hourly_extra_block_price_vnd: z.number().int().nullable(),
  hourly_overnight_surcharge_vnd: z.number().int().nullable(),
  hourly_overnight_start: z.string().nullable(),
  hourly_overnight_end: z.string().nullable(),
  daily_checkin_time: z.string().nullable(),
  daily_checkout_time: z.string().nullable(),
  daily_early_checkin_fee_vnd: z.number().int().nullable(),
  daily_late_checkout_fee_vnd: z.number().int().nullable(),
  monthly_includes_utilities: z.boolean().nullable(),
  monthly_electricity_per_kwh_vnd: z.number().int().nullable(),
  monthly_water_per_m3_vnd: z.number().int().nullable(),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
  resource_ids: z.array(z.uuid()),
  rules: z.array(RatePlanRuleResponseSchema).optional(), // chỉ ở getById
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type RatePlanResponse = z.infer<typeof RatePlanResponseSchema>;
