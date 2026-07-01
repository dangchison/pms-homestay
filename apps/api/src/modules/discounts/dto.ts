import {
  CreateDiscountCodeRequestSchema,
  UpdateDiscountCodeRequestSchema,
} from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class CreateDiscountCodeDto extends createZodDto(CreateDiscountCodeRequestSchema) {}
export class UpdateDiscountCodeDto extends createZodDto(UpdateDiscountCodeRequestSchema) {}
