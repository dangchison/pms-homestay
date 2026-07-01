import { z } from 'zod';
import { BookingModeSchema } from './rate-plan';

/** Loại dòng giá — khớp invoice_items.item_type (docs/03 §4.6). */
export const QuoteLineItemTypeSchema = z.enum([
  'ROOM_CHARGE',
  'SURCHARGE',
  'DISCOUNT',
  'TAX',
  'UTILITY',
  'AMENITY',
]);
export type QuoteLineItemType = z.infer<typeof QuoteLineItemTypeSchema>;

export const QuoteLineItemSchema = z.object({
  type: QuoteLineItemTypeSchema,
  description: z.string(),
  quantity: z.number(),
  unit_price_vnd: z.number().int(),
  amount_vnd: z.number().int(),
  local_date: z.string().optional(),
});
export type QuoteLineItem = z.infer<typeof QuoteLineItemSchema>;

/** POST /pricing/quote (docs/07 §6). rate_plan_id bỏ trống → dùng gói mặc định của resource. */
export const QuoteRequestSchema = z
  .object({
    resource_id: z.uuid(),
    rate_plan_id: z.uuid().optional(),
    mode: BookingModeSchema,
    check_in: z.iso.datetime(),
    check_out: z.iso.datetime(),
    adults: z.number().int().min(1).optional(),
    children: z.number().int().min(0).optional(),
    /**
     * Mã giảm giá / voucher (task 9.4c, docs/07 §7). OPTIONAL — bỏ trống thì báo giá
     * chạy y hệt trước (không voucher). Có mã → server áp qua DiscountsService.applyDiscount
     * (RLS + property của quote); mã KHÔNG hợp lệ → 422 DISCOUNT_NOT_APPLICABLE (KHÔNG
     * âm thầm áp 0, tránh booking sau rớt voucher). CITEXT ở DB — so khớp không phân biệt hoa/thường.
     */
    discount_code: z.string().min(1).max(64).optional(),
  })
  .refine((d) => new Date(d.check_out) > new Date(d.check_in), {
    message: 'check_out phải sau check_in',
    path: ['check_out'],
  });
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

export const QuoteResponseSchema = z.object({
  quote_id: z.uuid(),
  property_id: z.uuid(),
  resource_id: z.uuid(),
  rate_plan_id: z.uuid(),
  rate_plan_version: z.number().int(),
  mode: BookingModeSchema,
  check_in: z.iso.datetime(),
  check_out: z.iso.datetime(),
  adults: z.number().int(),
  children: z.number().int(),
  line_items: z.array(QuoteLineItemSchema),
  subtotal_vnd: z.number().int(),
  discount_vnd: z.number().int(),
  tax_vnd: z.number().int(),
  total_vnd: z.number().int(),
  deposit_vnd: z.number().int(),
  expires_at: z.iso.datetime(),
  holidays: z.array(z.object({ date: z.string(), name: z.string() })),
  /**
   * Mã voucher đã áp cho báo giá (task 9.4c). Bỏ trống/không có khi báo giá không dùng
   * voucher → shape backward-compatible tuyệt đối với client cũ (chỉ THÊM field optional,
   * không đổi field cũ). discount_vnd đã có sẵn (đã gồm phần voucher khi có mã).
   */
  discount_code: z.string().optional(),
});
export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;
