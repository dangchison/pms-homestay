import { Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Public } from '@core/http/decorators/public.decorator';
import { SkipTenantScope } from '@core/http/decorators/skip-tenant.decorator';
import { PlatformAuthGuard } from '@modules/platform-auth/platform-auth.guard';
import { SubscriptionService } from './subscription.service';

/**
 * /api/v1/platform/subscription-payments — endpoint platform admin xác nhận thanh
 * toán thuê bao (task 4.7). Bảo vệ bằng PlatformAuthGuard (B4 — thay header
 * `PLATFORM_ADMIN_SECRET`): Bearer token nền tảng (đăng nhập /platform/auth/login).
 * @Public + @SkipTenantScope: JwtAuthGuard tenant bỏ qua + không tenant context
 * (cross-tenant); auth thật do PlatformAuthGuard.
 */
@Controller('platform/subscription-payments')
export class PlatformBillingController {
  constructor(private readonly subscription: SubscriptionService) {}

  @Post(':id/confirm')
  @Public()
  @SkipTenantScope()
  @UseGuards(PlatformAuthGuard)
  @HttpCode(200)
  async confirm(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.subscription.confirmPayment(id) };
  }
}
