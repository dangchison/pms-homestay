import { CreateInvoiceRequestSchema, VoidInvoiceRequestSchema } from '@pms/shared-types';
import { z } from 'zod';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class CreateInvoiceDto extends createZodDto(CreateInvoiceRequestSchema) {}
export class VoidInvoiceDto extends createZodDto(VoidInvoiceRequestSchema) {}

const InvoiceListQuerySchema = z.object({ booking_id: z.uuid() });
export class InvoiceListQueryDto extends createZodDto(InvoiceListQuerySchema) {}
