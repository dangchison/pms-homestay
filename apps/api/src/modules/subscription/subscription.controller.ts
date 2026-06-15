import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { AllowSuspended } from '@core/http/decorators/allow-suspended.decorator';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { ChargeSubscriptionDto } from './dto';
import { SubscriptionService } from './subscription.service';

/**
 * /api/v1/billing — trang billing tenant (task 4.7). Toàn tenant (không
 * property-scope): quyền `tenant.billing.manage` (chỉ OWNER). `charge` gắn
 * @AllowSuspended để tenant bị treo vẫn thanh toán lại được (TenantStatusGuard
 * chặn mọi mutation khác khi SUSPENDED).
 */
@Controller('billing')
export class SubscriptionController {
  constructor(private readonly subscription: SubscriptionService) {}

  /** Gói hiện tại + trạng thái + usage (so với max_*). */
  @Get('subscription')
  @RequirePermissions('tenant.billing.manage')
  async summary(@CurrentUser() user: JwtClaims) {
    return { data: await this.subscription.getSummary(user) };
  }

  /** Danh sách gói khả dụng (task 6.7 S3 — chọn để nâng cấp). */
  @Get('plans')
  @RequirePermissions('tenant.billing.manage')
  async plans() {
    return { data: await this.subscription.listPlans() };
  }

  /** Lịch sử thanh toán thuê bao. */
  @Get('payments')
  @RequirePermissions('tenant.billing.manage')
  async payments(@CurrentUser() user: JwtClaims) {
    return { data: await this.subscription.listPayments(user) };
  }

  /** Tạo yêu cầu thu phí → trả VietQR; platform admin xác nhận sau (kích hoạt). */
  @Post('charge')
  @RequirePermissions('tenant.billing.manage')
  @AllowSuspended()
  @HttpCode(200)
  async charge(@Body() dto: ChargeSubscriptionDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.subscription.charge(user, dto.plan_code) };
  }
}
