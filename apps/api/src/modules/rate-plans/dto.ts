import {
  AssignRatePlanResourcesRequestSchema,
  BookingModeSchema,
  CreateRatePlanRequestSchema,
  CreateRatePlanRuleRequestSchema,
  UpdateRatePlanRequestSchema,
  UpdateRatePlanRuleRequestSchema,
} from '@pms/shared-types';
import { z } from 'zod';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class CreateRatePlanDto extends createZodDto(CreateRatePlanRequestSchema) {}
export class UpdateRatePlanDto extends createZodDto(UpdateRatePlanRequestSchema) {}
export class AssignResourcesDto extends createZodDto(AssignRatePlanResourcesRequestSchema) {}
export class CreateRatePlanRuleDto extends createZodDto(CreateRatePlanRuleRequestSchema) {}
export class UpdateRatePlanRuleDto extends createZodDto(UpdateRatePlanRuleRequestSchema) {}

const RatePlanListQuerySchema = z.object({
  property_id: z.uuid(),
  mode: BookingModeSchema.optional(),
});
export class RatePlanListQueryDto extends createZodDto(RatePlanListQuerySchema) {}
