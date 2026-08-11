import { z } from 'zod';
import { MoneyVndSchema } from './common';
import { SubscriptionPlanCodeSchema, SubscriptionPlanSchema, TenantStatusSchema } from './tenant';

/**
 * Billing-lite SaaS (task 4.7, docs/02 §6). Thuê bao nền tảng: trang billing
 * (gói + usage + lịch sử), thu phí VietQR động, platform admin xác nhận.
 */
export const SubscriptionPaymentStatusSchema = z.enum(['PENDING', 'CONFIRMED', 'CANCELLED']);
export type SubscriptionPaymentStatus = z.infer<typeof SubscriptionPaymentStatusSchema>;

/**
 * Cờ tính năng theo gói — khớp khoá trong `subscription_plans.features` (JSONB).
 * Đặt ở shared-types vì cả ba phía đều cần cùng một danh sách: API gác endpoint
 * (@RequirePlanFeature), web-platform cho admin bật/tắt, web-site liệt kê bảng
 * giá. Thêm khoá mới ở đây trước, rồi mới gắn guard.
 */
export const PlanFeatureSchema = z.enum([
  'ota_sync',
  'vietqr',
  'invoices',
  'compliance',
  'cleaning',
  'multi_property_reports',
  'assets',
  'shifts',
  'zns',
  'api_access',
]);
export type PlanFeature = z.infer<typeof PlanFeatureSchema>;
export const PLAN_FEATURES = PlanFeatureSchema.options;

/** Nhãn tiếng Việt — dùng cho thông báo 402, danh sách tick, bảng giá. */
export const PLAN_FEATURE_LABEL: Record<PlanFeature, string> = {
  ota_sync: 'đồng bộ kênh OTA',
  vietqr: 'thu tiền VietQR',
  invoices: 'hoá đơn',
  compliance: 'khai báo lưu trú và OCR CCCD',
  cleaning: 'dọn phòng và ứng dụng nhân viên',
  multi_property_reports: 'báo cáo hợp nhất nhiều cơ sở',
  assets: 'tài sản và khấu hao',
  shifts: 'bàn giao ca quầy',
  zns: 'tin nhắn ZNS',
  api_access: 'API và webhook',
};

/** Số phòng của MỘT cơ sở — đối chiếu với plan.max_rooms_per_property. */
export const PropertyRoomUsageSchema = z.object({
  property_id: z.uuid(),
  property_name: z.string(),
  rooms: z.number().int().nonnegative(),
});
export type PropertyRoomUsage = z.infer<typeof PropertyRoomUsageSchema>;

/** Số lượng tài nguyên đang dùng (so với plan.max_*). */
export const SubscriptionUsageSchema = z.object({
  properties: z.number().int().nonnegative(),
  rooms: z.number().int().nonnegative(),
  users: z.number().int().nonnegative(),
  /** Chi tiết từng cơ sở — trang billing hiện "cơ sở A: 5/15 phòng". */
  rooms_by_property: z.array(PropertyRoomUsageSchema),
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
