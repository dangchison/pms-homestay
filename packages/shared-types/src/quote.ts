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
});
export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;
