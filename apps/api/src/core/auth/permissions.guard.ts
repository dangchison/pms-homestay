import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';
import { AppException } from '@core/http/exceptions/app.exception';
import { PERMISSIONS_KEY } from '@core/http/decorators/require-permissions.decorator';
import { PermissionService } from './permission.service';
import { roleHasPermission, type Permission } from './permissions';

/**
 * Pha 1 RBAC (docs/04 §4): tenant khớp + pv khớp Redis + permission theo ROLE.
 * Đủ cho endpoint không gắn resource cụ thể; endpoint trên resource phải thêm
 * pha 2 authorizeOnProperty trong service (property resolve TỪ ENTITY).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user;
    if (!user) {
      throw new AppException({ code: 'AUTH_UNAUTHENTICATED', title: 'Cần đăng nhập', status: 401 });
    }

    if (user.tnt !== req.tenantId) {
      throw new AppException({
        code: 'AUTHZ_TENANT_MISMATCH',
        title: 'Token không thuộc tenant này',
        status: 403,
      });
    }

    await this.permissionService.assertPermissionVersion(user);

    const missing = required.filter((p) => !roleHasPermission(user.rol, p));
    if (missing.length > 0) {
      throw new AppException({
        code: 'AUTHZ_NO_PERMISSION',
        title: 'Không có quyền thực hiện thao tác này',
        status: 403,
        detail: `Thiếu quyền: ${missing.join(', ')}`,
      });
    }
    return true;
  }
}
