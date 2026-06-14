import { ChargeSubscriptionRequestSchema } from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class ChargeSubscriptionDto extends createZodDto(ChargeSubscriptionRequestSchema) {}
