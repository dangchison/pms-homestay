import {
  CloseShiftRequestSchema,
  OpenShiftRequestSchema,
  ShiftsListQuerySchema,
} from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class OpenShiftDto extends createZodDto(OpenShiftRequestSchema) {}
export class CloseShiftDto extends createZodDto(CloseShiftRequestSchema) {}
export class ShiftsListQueryDto extends createZodDto(ShiftsListQuerySchema) {}
