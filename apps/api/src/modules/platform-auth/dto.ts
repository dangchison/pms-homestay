import { PlatformLoginRequestSchema } from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class PlatformLoginDto extends createZodDto(PlatformLoginRequestSchema) {}
