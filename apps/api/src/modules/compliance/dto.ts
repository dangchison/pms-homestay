import { PoliceReportQuerySchema } from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class PoliceReportQueryDto extends createZodDto(PoliceReportQuerySchema) {}
