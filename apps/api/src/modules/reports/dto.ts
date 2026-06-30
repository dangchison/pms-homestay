import {
  BreakEvenQuerySchema,
  LandlordStatementQuerySchema,
  OccupancyReportQuerySchema,
  PnlQuerySchema,
} from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class PnlQueryDto extends createZodDto(PnlQuerySchema) {}
export class BreakEvenQueryDto extends createZodDto(BreakEvenQuerySchema) {}
export class OccupancyReportQueryDto extends createZodDto(OccupancyReportQuerySchema) {}
export class LandlordStatementQueryDto extends createZodDto(LandlordStatementQuerySchema) {}
