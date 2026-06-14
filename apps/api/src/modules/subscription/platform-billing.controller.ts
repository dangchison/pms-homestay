import { timingSafeEqual } from 'node:crypto';
import { Controller, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ENV, type Env } from '@core/config/env.schema';
import { Public } from '@core/http/decorators/public.decorator';
import { SkipTenantScope } from '@core/http/decorators/skip-tenant.decorator';
import { AppException } from '@core/http/exceptions/app.exception';
import { SubscriptionService } from './subscription.service';

/**
 * /api/v1/platform/subscription-payments — endpoint platform admin xác nhận
 * thanh toán thuê bao (task 4.7). Chưa có platform-auth module → bảo vệ bằng
 * secret `PLATFORM_ADMIN_SECRET` qua header X-Platform-Secret (giống webhook 3.4).
 * @Public + @SkipTenantScope: không JWT, không tenant context (cross-tenant).
 */
@Controller('platform/subscription-payments')
export class PlatformBillingController {
  constructor(
    private readonly subscription: SubscriptionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post(':id/confirm')
  @Public()
  @SkipTenantScope()
  @HttpCode(200)
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-platform-secret') secret: string | undefined,
  ) {
    this.assertPlatformSecret(secret);
    return { data: await this.subscription.confirmPayment(id) };
  }

  /** So secret timing-safe; thiếu cấu hình → 503, sai/thiếu → 401. */
  private assertPlatformSecret(given: string | undefined): void {
    const secret = this.env.PLATFORM_ADMIN_SECRET;
    if (!secret) {
      throw new AppException({
        code: 'PLATFORM_BILLING_NOT_CONFIGURED',
        title: 'Chưa cấu hình PLATFORM_ADMIN_SECRET',
        status: 503,
      });
    }
    if (!given) {
      throw new AppException({ code: 'PLATFORM_UNAUTHORIZED', title: 'Thiếu X-Platform-Secret', status: 401 });
    }
    const expected = Buffer.from(secret);
    const provided = Buffer.from(given);
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      throw new AppException({ code: 'PLATFORM_UNAUTHORIZED', title: 'Sai secret nền tảng', status: 401 });
    }
  }
}
