import { z } from 'zod';

/** docs/03 §4.6 — phương thức thanh toán (VARCHAR+CHECK ở DB). */
export const PaymentMethodSchema = z.enum([
  'CASH',
  'VIETQR',
  'BANK_TRANSFER',
  'MOMO',
  'ZALOPAY',
  'CARD',
  'OTA_COLLECTED',
  'OTHER',
]);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const PaymentStatusSchema = z.enum([
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

/**
 * POST /payments (docs/09 §5) — ghi nhận thanh toán thủ công (tiền mặt/chuyển
 * khoản), SUCCEEDED ngay. Idempotency-Key qua header. method mặc định CASH.
 */
export const CreatePaymentRequestSchema = z.object({
  invoice_id: z.uuid(),
  amount_vnd: z.number().int().positive(),
  method: PaymentMethodSchema.default('CASH'),
  reference_code: z.string().max(255).optional(),
});
export type CreatePaymentRequest = z.infer<typeof CreatePaymentRequestSchema>;

/** POST /payments/:id/refund — bỏ trống amount = hoàn toàn bộ phần còn lại. */
export const RefundPaymentRequestSchema = z.object({
  amount_vnd: z.number().int().positive().optional(),
  reason: z.string().min(1).max(500),
});
export type RefundPaymentRequest = z.infer<typeof RefundPaymentRequestSchema>;

export const PaymentResponseSchema = z.object({
  id: z.uuid(),
  invoice_id: z.uuid(),
  amount_vnd: z.number().int(),
  method: PaymentMethodSchema,
  status: PaymentStatusSchema,
  reference_code: z.string().nullable(),
  refunded_amount_vnd: z.number().int(),
  received_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
});
export type PaymentResponse = z.infer<typeof PaymentResponseSchema>;
