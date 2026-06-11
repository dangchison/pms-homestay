import { CreateWholeResourceRequestSchema, UpdateResourceRequestSchema } from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class CreateWholeResourceDto extends createZodDto(CreateWholeResourceRequestSchema) {}
export class UpdateResourceDto extends createZodDto(UpdateResourceRequestSchema) {}
