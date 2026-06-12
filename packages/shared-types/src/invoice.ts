import { z } from 'zod';

/** docs/03 §4.6 — booking↔invoice 1:N qua kind (ADR-0003 amendment). */
export const InvoiceKindSchema = z.enum(['DEPOSIT', 'STAY', 'MONTHLY_RENT', 'ADJUSTMENT']);
export type InvoiceKind = z.infer<typeof InvoiceKindSchema>;

export const InvoiceStatusSchema = z.enum([
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'VOID',
  'REFUNDED',
]);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

/** = QuoteLineItemType + DEPOSIT_APPLIED (dòng cấn cọc, amount ÂM). */
export const InvoiceItemTypeSchema = z.enum([
  'ROOM_CHARGE',
  'SURCHARGE',
  'DISCOUNT',
  'TAX',
  'UTILITY',
  'AMENITY',
  'DEPOSIT_APPLIED',
]);
export type InvoiceItemType = z.infer<typeof InvoiceItemTypeSchema>;

export const InvoiceItemResponseSchema = z.object({
  id: z.uuid(),
  item_type: InvoiceItemTypeSchema,
  description: z.string(),
  quantity: z.number(),
  unit_price_vnd: z.number().int(),
  amount_vnd: z.number().int(),
  ref_invoice_id: z.uuid().nullable(),
  display_order: z.number().int(),
});
export type InvoiceItemResponse = z.infer<typeof InvoiceItemResponseSchema>;

export const InvoiceResponseSchema = z.object({
  id: z.uuid(),
  booking_id: z.uuid().nullable(),
  kind: InvoiceKindSchema,
  invoice_number: z.string(),
  status: InvoiceStatusSchema,
  billing_period: z.string().nullable(),
  subtotal_vnd: z.number().int(),
  discount_vnd: z.number().int(),
  tax_vnd: z.number().int(),
  total_vnd: z.number().int(),
  paid_vnd: z.number().int(),
  balance_vnd: z.number().int(),
  due_date: z.string().nullable(),
  issued_at: z.iso.datetime().nullable(),
  paid_at: z.iso.datetime().nullable(),
  void_reason: z.string().nullable(),
  version: z.number().int(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  items: z.array(InvoiceItemResponseSchema),
});
export type InvoiceResponse = z.infer<typeof InvoiceResponseSchema>;

/** Dòng nhập tay cho invoice ad-hoc (amount = quantity × unit_price, tính ở server). */
export const CreateInvoiceItemSchema = z.object({
  item_type: InvoiceItemTypeSchema.exclude(['DEPOSIT_APPLIED']), // cấn cọc do hệ thống sinh
  description: z.string().min(1).max(500),
  quantity: z.number().positive().default(1),
  unit_price_vnd: z.number().int(),
});
export type CreateInvoiceItem = z.infer<typeof CreateInvoiceItemSchema>;

/**
 * POST /invoices (docs/09 §4.4) — invoice ad-hoc/ADJUSTMENT. `issue=true` phát
 * hành ngay (DRAFT→ISSUED); else giữ DRAFT để sửa items.
 */
export const CreateInvoiceRequestSchema = z.object({
  booking_id: z.uuid().optional(),
  kind: z.enum(['ADJUSTMENT', 'STAY']).default('ADJUSTMENT'),
  due_date: z.string().optional(),
  items: z.array(CreateInvoiceItemSchema).min(1),
  issue: z.boolean().default(false),
});
export type CreateInvoiceRequest = z.infer<typeof CreateInvoiceRequestSchema>;

export const VoidInvoiceRequestSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type VoidInvoiceRequest = z.infer<typeof VoidInvoiceRequestSchema>;
