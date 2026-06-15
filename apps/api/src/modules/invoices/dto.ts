import {
  CreateInvoiceRequestSchema,
  InvoiceKindSchema,
  InvoiceStatusSchema,
  OffsetPaginationQuerySchema,
  VoidInvoiceRequestSchema,
} from '@pms/shared-types';
import { z } from 'zod';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class CreateInvoiceDto extends createZodDto(CreateInvoiceRequestSchema) {}
export class VoidInvoiceDto extends createZodDto(VoidInvoiceRequestSchema) {}

/**
 * GET /invoices — 2 chế độ: `booking_id` (tra cứu hoá đơn của 1 booking, dùng ở B3)
 * HOẶC `property_id` + filter (danh sách F1, task 6.4). Cần đúng 1 trong 2.
 */
const InvoiceListQuerySchema = OffsetPaginationQuerySchema.extend({
  booking_id: z.uuid().optional(),
  property_id: z.uuid().optional(),
  status: InvoiceStatusSchema.optional(),
  kind: InvoiceKindSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
}).refine((d) => Boolean(d.booking_id) || Boolean(d.property_id), {
  message: 'Cần booking_id hoặc property_id',
});
export class InvoiceListQueryDto extends createZodDto(InvoiceListQuerySchema) {}
