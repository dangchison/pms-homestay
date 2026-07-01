import {
  CreateDiscountCodeRequestSchema,
  DiscountValidateQuerySchema,
  UpdateDiscountCodeRequestSchema,
} from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class CreateDiscountCodeDto extends createZodDto(CreateDiscountCodeRequestSchema) {}
export class UpdateDiscountCodeDto extends createZodDto(UpdateDiscountCodeRequestSchema) {}
/** Query GET /discount-codes/:code/validate (9.4c): subtotal_vnd (coerce int≥0) + property_id uuid. */
export class DiscountValidateQueryDto extends createZodDto(DiscountValidateQuerySchema) {}
