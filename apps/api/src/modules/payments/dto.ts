import {
  CreatePaymentRequestSchema,
  OffsetPaginationQuerySchema,
  PaymentMethodSchema,
  PaymentStatusSchema,
  PaymentWebhookSchema,
  RefundPaymentRequestSchema,
  ResolveUnmatchedRequestSchema,
} from '@pms/shared-types';
import { z } from 'zod';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class CreatePaymentDto extends createZodDto(CreatePaymentRequestSchema) {}
export class RefundPaymentDto extends createZodDto(RefundPaymentRequestSchema) {}
export class PaymentWebhookDto extends createZodDto(PaymentWebhookSchema) {}
export class ResolveUnmatchedDto extends createZodDto(ResolveUnmatchedRequestSchema) {}

/**
 * GET /payments — 2 chế độ: `invoice_id` (payment của 1 hoá đơn, F2) HOẶC
 * `property_id` + filter (sổ thanh toán F3). Cần đúng 1 trong 2.
 */
const PaymentsListQuerySchema = OffsetPaginationQuerySchema.extend({
  invoice_id: z.uuid().optional(),
  property_id: z.uuid().optional(),
  status: PaymentStatusSchema.optional(),
  method: PaymentMethodSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
}).refine((d) => Boolean(d.invoice_id) || Boolean(d.property_id), {
  message: 'Cần invoice_id hoặc property_id',
});
export class PaymentsListQueryDto extends createZodDto(PaymentsListQuerySchema) {}
