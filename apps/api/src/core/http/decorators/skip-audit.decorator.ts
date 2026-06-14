import { SetMetadata } from '@nestjs/common';

export const SKIP_AUDIT_KEY = 'skip_audit';

/**
 * Bỏ qua AuditInterceptor cho 1 endpoint mutation (vd: route tần suất cao,
 * không phải thao tác entity). Mặc định MỌI POST/PATCH/PUT/DELETE đều được audit.
 */
export const SkipAudit = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_AUDIT_KEY, true);
