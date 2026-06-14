import { z } from 'zod';
import { MoneyVndSchema } from './common';
import { SubscriptionPlanCodeSchema, SubscriptionPlanSchema, TenantStatusSchema } from './tenant';

/**
 * Billing-lite SaaS (task 4.7, docs/02 §6). Thuê bao nền tảng: trang billing
 * (gói + usage + lịch sử), thu phí VietQR động, platform admin xác nhận.
 */
export const SubscriptionPaymentStatusSchema = z.enum(['PENDING', 'CONFIRMED', 'CANCELLED']);
export type SubscriptionPaymentStatus = z.infer<typeof SubscriptionPaymentStatusSchema>;

/** Số lượng tài nguyên đang dùng (so với plan.max_*). */
export const SubscriptionUsageSchema = z.object({
  properties: z.number().int().nonnegative(),
  rooms: z.number().int().nonnegative(),
  users: z.number().int().nonnegative(),
});
export type SubscriptionUsage = z.infer<typeof SubscriptionUsageSchema>;

/** GET /billing/subscription — gói hiện tại + trạng thái + usage. */
export const SubscriptionSummaryResponseSchema = z.object({
  status: TenantStatusSchema,
  trial_ends_at: z.iso.datetime().nullable(),
  current_period_end: z.iso.datetime().nullable(),
  plan: SubscriptionPlanSchema.nullable(),
  usage: SubscriptionUsageSchema,
});
export type SubscriptionSummaryResponse = z.infer<typeof SubscriptionSummaryResponseSchema>;

/** 1 dòng lịch sử thanh toán thuê bao. */
export const SubscriptionPaymentResponseSchema = z.object({
  id: z.uuid(),
  plan_code: z.string(),
  amount_vnd: MoneyVndSchema,
  period_start: z.iso.datetime(),
  period_end: z.iso.datetime(),
  status: SubscriptionPaymentStatusSchema,
  payment_ref: z.string(),
  confirmed_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
});
export type SubscriptionPaymentResponse = z.infer<typeof SubscriptionPaymentResponseSchema>;

/** POST /billing/charge — chọn gói muốn trả (mặc định gói hiện tại). */
export const ChargeSubscriptionRequestSchema = z.object({
  plan_code: SubscriptionPlanCodeSchema.optional(),
});
export type ChargeSubscriptionRequest = z.infer<typeof ChargeSubscriptionRequestSchema>;

/** Trả về payment PENDING + dữ liệu VietQR để FE render QR (NAPAS 247). */
export const ChargeSubscriptionResponseSchema = z.object({
  payment: SubscriptionPaymentResponseSchema,
  qr: z.object({
    payload: z.string(), // EMVCo payload (FE render QR hoặc dùng /qr-image)
    amount_vnd: MoneyVndSchema,
    bank_bin: z.string(),
    account_number: z.string(),
    add_info: z.string(),
  }),
});
export type ChargeSubscriptionResponse = z.infer<typeof ChargeSubscriptionResponseSchema>;
