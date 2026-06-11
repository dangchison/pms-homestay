import { SetMetadata } from '@nestjs/common';
import { type Permission } from '@core/auth/permissions';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Khai báo permission cần cho endpoint — PermissionsGuard check pha 1
 * (tenant + pv + role). Endpoint thao tác trên resource cụ thể PHẢI gọi thêm
 * authorizeOnProperty() trong service sau khi load entity (pha 2, docs/04 §4).
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
