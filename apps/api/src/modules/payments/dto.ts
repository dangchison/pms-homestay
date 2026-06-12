import {
  CreatePaymentRequestSchema,
  PaymentWebhookSchema,
  RefundPaymentRequestSchema,
  ResolveUnmatchedRequestSchema,
} from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class CreatePaymentDto extends createZodDto(CreatePaymentRequestSchema) {}
export class RefundPaymentDto extends createZodDto(RefundPaymentRequestSchema) {}
export class PaymentWebhookDto extends createZodDto(PaymentWebhookSchema) {}
export class ResolveUnmatchedDto extends createZodDto(ResolveUnmatchedRequestSchema) {}
