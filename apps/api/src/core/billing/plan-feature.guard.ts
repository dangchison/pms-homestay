import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLAN_FEATURE_LABEL, type PlanFeature } from '@pms/shared-types';
import { type Request } from 'express';
import { IS_PUBLIC_KEY } from '@core/http/decorators/public.decorator';
import { SKIP_TENANT_KEY } from '@core/http/decorators/skip-tenant.decorator';
import { AppException } from '@core/http/exceptions/app.exception';
import { PLAN_FEATURE_KEY } from './plan-feature';
import { PlanFeatureService } from './plan-feature.service';

/**
 * Chặn endpoint theo cờ tính năng của gói (@RequirePlanFeature). Chạy sau
 * TenantStatusGuard: tới đây tenant đã qua auth, RBAC và trạng thái thuê bao,
 * chỉ còn câu hỏi "gói này có mua tính năng đó không".
 *
 * 402 Payment Required — cố ý khác 403 của RBAC: FE phân biệt được "bạn không có
 * quyền" với "gói của bạn chưa có, nâng gói là dùng được".
 *
 * Tenant chưa gán gói thì cho qua, giống assertWithinPlanLimitTx — không để lỗi
 * dữ liệu master biến thành khoá sản phẩm.
 */
@Injectable()
export class PlanFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly planFeatures: PlanFeatureService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];

    const feature = this.reflector.getAllAndOverride<PlanFeature>(PLAN_FEATURE_KEY, targets);
    if (!feature) return true;

    const skip =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ||
      this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, targets);
    if (skip) return true;

    const req = context.switchToHttp().getRequest<Request & { tenantId?: string }>();
    const tenantId = req.tenantId;
    if (!tenantId) return true; // TenantGuard đã lo route tenant-scoped thiếu tenant

    const plan = await this.planFeatures.get(tenantId);
    if (!plan) return true;
    if (plan.features[feature] === true) return true;

    throw new AppException({
      code: 'PLAN_FEATURE_REQUIRED',
      title: 'Gói hiện tại chưa có tính năng này',
      status: 402,
      detail: `Gói ${plan.plan_code} không bao gồm ${PLAN_FEATURE_LABEL[feature]}. Nâng gói để dùng (POST /billing/charge).`,
    });
  }
}
