import {
  CreateForeignResidenceRequestSchema,
  DataCorrectionRequestSchema,
  ForeignResidenceListQuerySchema,
  GrantConsentRequestSchema,
  PoliceReportQuerySchema,
  SubmitPoliceReportRequestSchema,
  UpdateForeignResidenceRequestSchema,
} from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class PoliceReportQueryDto extends createZodDto(PoliceReportQuerySchema) {}
export class SubmitPoliceReportDto extends createZodDto(SubmitPoliceReportRequestSchema) {}
export class GrantConsentDto extends createZodDto(GrantConsentRequestSchema) {}
export class DataCorrectionDto extends createZodDto(DataCorrectionRequestSchema) {}
export class CreateForeignResidenceDto extends createZodDto(CreateForeignResidenceRequestSchema) {}
export class UpdateForeignResidenceDto extends createZodDto(UpdateForeignResidenceRequestSchema) {}
export class ForeignResidenceListQueryDto extends createZodDto(ForeignResidenceListQuerySchema) {}
