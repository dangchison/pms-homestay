import { SetMetadata } from '@nestjs/common';

export const ALLOW_SUSPENDED_KEY = 'allow_suspended';

/**
 * Cho phép endpoint mutation chạy kể cả khi tenant SUSPENDED (task 4.7) — dành
 * cho route billing (POST /billing/charge) để tenant bị treo vẫn thanh toán lại
 * được. TenantStatusGuard bỏ qua chặn write khi thấy marker này.
 */
export const AllowSuspended = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_SUSPENDED_KEY, true);
