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

/**
 * Payload webhook thanh toán đã chuẩn hoá (Casso/SePay) — docs/09 §5. `event_id`
 * dedup; `content` chứa mã BK-/INV-; `bank_account` để resolve tenant.
 */
export const PaymentWebhookSchema = z.object({
  event_id: z.string().min(1).max(255),
  amount_vnd: z.number().int().positive(),
  content: z.string().max(2000).default(''),
  bank_account: z.string().min(1).max(64),
  received_at: z.iso.datetime().optional(),
});
export type PaymentWebhook = z.infer<typeof PaymentWebhookSchema>;

/**
 * POST /dev/simulate-bank-transfer (Đợt 4/M4 — dev-only) — giả lập 1 giao dịch
 * chuyển khoản để khép vòng đối soát demo. Endpoint dựng `PaymentWebhook` chuẩn hoá
 * từ payload này rồi chạy acceptWebhook + reconcile ĐỒNG BỘ (worker off). `content`
 * để trống thì tự dựng từ `booking_code`/`invoice_number` (tiện demo). KHÔNG chứa PII.
 */
export const SimulateBankTransferSchema = z.object({
  bank_account: z.string().min(1).max(64),
  amount_vnd: z.number().int().positive(),
  content: z.string().max(2000).optional(),
  provider: z.enum(['casso', 'sepay']).default('casso'),
  booking_code: z.string().max(255).optional(),
  invoice_number: z.string().max(255).optional(),
  event_id: z.string().min(1).max(255).optional(),
});
export type SimulateBankTransfer = z.infer<typeof SimulateBankTransferSchema>;

export const UnmatchedPaymentStatusSchema = z.enum(['PENDING', 'RESOLVED', 'IGNORED']);
export type UnmatchedPaymentStatus = z.infer<typeof UnmatchedPaymentStatusSchema>;

export const UnmatchedPaymentResponseSchema = z.object({
  id: z.uuid(),
  provider: z.string(),
  transaction_ref: z.string(),
  amount_vnd: z.number().int(),
  content: z.string().nullable(),
  bank_account: z.string().nullable(),
  received_at: z.iso.datetime().nullable(),
  status: UnmatchedPaymentStatusSchema,
  resolved_payment_id: z.uuid().nullable(),
  created_at: z.iso.datetime(),
});
export type UnmatchedPaymentResponse = z.infer<typeof UnmatchedPaymentResponseSchema>;

/** POST /payments/unmatched/:id/resolve — gán giao dịch vào invoice → tạo payment. */
export const ResolveUnmatchedRequestSchema = z.object({
  invoice_id: z.uuid(),
});
export type ResolveUnmatchedRequest = z.infer<typeof ResolveUnmatchedRequestSchema>;

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
