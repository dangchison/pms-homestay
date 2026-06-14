import {
  DataCorrectionRequestSchema,
  GrantConsentRequestSchema,
  PoliceReportQuerySchema,
} from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class PoliceReportQueryDto extends createZodDto(PoliceReportQuerySchema) {}
export class GrantConsentDto extends createZodDto(GrantConsentRequestSchema) {}
export class DataCorrectionDto extends createZodDto(DataCorrectionRequestSchema) {}
