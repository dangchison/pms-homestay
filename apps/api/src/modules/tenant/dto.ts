import { UpdateTenantRequestSchema } from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class UpdateTenantDto extends createZodDto(UpdateTenantRequestSchema) {}
