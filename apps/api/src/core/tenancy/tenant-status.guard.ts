import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';
import { AppException } from '@core/http/exceptions/app.exception';
import { ALLOW_SUSPENDED_KEY } from '@core/http/decorators/allow-suspended.decorator';
import { IS_PUBLIC_KEY } from '@core/http/decorators/public.decorator';
import { SKIP_TENANT_KEY } from '@core/http/decorators/skip-tenant.decorator';
import { TenantStatusService } from './tenant-status.service';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Chặn theo trạng thái thuê bao (task 4.7, docs/02 §6) — chạy sau JwtAuthGuard
 * (đã set req.tenantId):
 *  - **SUSPENDED**: chặn MUTATION (POST/PATCH/PUT/DELETE) → 403 TENANT_SUSPENDED;
 *    vẫn cho đọc (GET) và route @AllowSuspended (billing để thanh toán lại).
 *  - **CHURNED**: chặn MỌI truy cập tenant → 403 TENANT_CHURNED (chỉ platform xem).
 * Bỏ qua @Public / @SkipTenantScope (auth, platform, iCal public).
 */
@Injectable()
export class TenantStatusGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantStatus: TenantStatusService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    const skip =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ||
      this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, targets);
    if (skip) return true;

    const req = context.switchToHttp().getRequest<Request & { tenantId?: string }>();
    const tenantId = req.tenantId;
    if (!tenantId) return true; // route tenant-scoped thiếu tenant đã bị TenantGuard chặn

    const status = await this.tenantStatus.getStatus(tenantId);
    if (status === 'CHURNED') {
      throw new AppException({
        code: 'TENANT_CHURNED',
        title: 'Thuê bao đã đóng',
        status: 403,
        detail: 'Tài khoản đã ngừng hoạt động — liên hệ hỗ trợ để khôi phục.',
      });
    }
    if (status === 'SUSPENDED' && MUTATING_METHODS.has(req.method?.toUpperCase() ?? '')) {
      const allowSuspended = this.reflector.getAllAndOverride<boolean>(ALLOW_SUSPENDED_KEY, targets);
      if (!allowSuspended) {
        throw new AppException({
          code: 'TENANT_SUSPENDED',
          title: 'Thuê bao đã bị tạm ngưng',
          status: 403,
          detail: 'Hết hạn dùng thử/thuê bao — vui lòng thanh toán để kích hoạt lại (chỉ đọc được dữ liệu).',
        });
      }
    }
    return true;
  }
}
