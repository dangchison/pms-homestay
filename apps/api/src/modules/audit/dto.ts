import { AuditLogListQuerySchema } from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class AuditLogListQueryDto extends createZodDto(AuditLogListQuerySchema) {}
