import { CreatePropertyRequestSchema, UpdatePropertyRequestSchema } from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class CreatePropertyDto extends createZodDto(CreatePropertyRequestSchema) {}
export class UpdatePropertyDto extends createZodDto(UpdatePropertyRequestSchema) {}
