import { QuoteRequestSchema } from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class QuoteDto extends createZodDto(QuoteRequestSchema) {}
