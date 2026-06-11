import {
  BlacklistGuestRequestSchema,
  CreateGuestRequestSchema,
  OffsetPaginationQuerySchema,
  UpdateGuestRequestSchema,
} from '@pms/shared-types';
import { z } from 'zod';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class CreateGuestDto extends createZodDto(CreateGuestRequestSchema) {}
export class UpdateGuestDto extends createZodDto(UpdateGuestRequestSchema) {}
export class BlacklistGuestDto extends createZodDto(BlacklistGuestRequestSchema) {}

const GuestListQuerySchema = OffsetPaginationQuerySchema.extend({
  q: z.string().min(1).optional(),
  id_document_number: z.string().min(1).optional(),
});
export class GuestListQueryDto extends createZodDto(GuestListQuerySchema) {}
