import {
  BlacklistGuestRequestSchema,
  CreateGuestRequestSchema,
  IdScanPresignRequestSchema,
  OffsetPaginationQuerySchema,
  ScanIdRequestSchema,
  UpdateGuestRequestSchema,
} from '@pms/shared-types';
import { z } from 'zod';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class CreateGuestDto extends createZodDto(CreateGuestRequestSchema) {}
export class UpdateGuestDto extends createZodDto(UpdateGuestRequestSchema) {}
export class BlacklistGuestDto extends createZodDto(BlacklistGuestRequestSchema) {}
export class IdScanPresignDto extends createZodDto(IdScanPresignRequestSchema) {}
export class ScanIdDto extends createZodDto(ScanIdRequestSchema) {}

const GuestListQuerySchema = OffsetPaginationQuerySchema.extend({
  q: z.string().min(1).optional(),
  id_document_number: z.string().min(1).optional(),
});
export class GuestListQueryDto extends createZodDto(GuestListQuerySchema) {}
