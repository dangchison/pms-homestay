import {
  CreatePlatformPlanRequestSchema,
  PlatformPaymentListQuerySchema,
  PlatformTenantListQuerySchema,
  UpdatePlatformPlanRequestSchema,
  UpdatePlatformTenantRequestSchema,
} from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class CreatePlanDto extends createZodDto(CreatePlatformPlanRequestSchema) {}
export class UpdatePlanDto extends createZodDto(UpdatePlatformPlanRequestSchema) {}
export class TenantListQueryDto extends createZodDto(PlatformTenantListQuerySchema) {}
export class UpdateTenantDto extends createZodDto(UpdatePlatformTenantRequestSchema) {}
export class PaymentListQueryDto extends createZodDto(PlatformPaymentListQuerySchema) {}
