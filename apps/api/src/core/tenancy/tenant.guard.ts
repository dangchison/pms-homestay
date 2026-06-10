import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';
import { AppException } from '@core/http/exceptions/app.exception';
import { IS_PUBLIC_KEY } from '@core/http/decorators/public.decorator';
import { SKIP_TENANT_KEY } from '@core/http/decorators/skip-tenant.decorator';

/**
 * Chặn request chưa resolve được tenant (docs/02 §resolution).
 * Bỏ qua khi handler/class đánh dấu @Public() hoặc @SkipTenantScope()
 * (health, /auth/login, iCal public, platform admin).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    const skipTenant = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, targets);
    if (isPublic || skipTenant) return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (!req.tenantId) {
      throw new AppException({
        code: 'TENANT_CONTEXT_MISSING',
        title: 'Không xác định được tenant cho request này',
        status: 400,
        detail: 'Cần đăng nhập (JWT), subdomain tenant, hoặc header X-Tenant-Slug',
      });
    }
    return true;
  }
}
