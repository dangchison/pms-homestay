import { Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { type Request } from 'express';
import type Redis from 'ioredis';
import { ENV, type Env } from '@core/config/env.schema';
import { Public } from '@core/http/decorators/public.decorator';
import { SkipTenantScope } from '@core/http/decorators/skip-tenant.decorator';
import { AppException } from '@core/http/exceptions/app.exception';
import { assertWithinRateLimit } from '@core/redis/rate-limit';
import { REDIS } from '@core/redis/redis.module';
import { SubscriptionService } from './subscription.service';

/** Rate limit endpoint mock-gateway: n lần / cửa sổ / (IP, paymentRef). */
const RATE_LIMIT = 10;
const RATE_WINDOW_SECONDS = 60;

/**
 * POST /api/v1/public/billing/mock-gateway/:paymentRef/pay (Đợt 4/M2, docs/18 B4)
 * — cổng thanh toán GIẢ LẬP để chạy end-to-end billing SaaS KHÔNG cần creds cổng
 * thật. `@Public` (bỏ JWT) + `@SkipTenantScope` (bỏ tenant GUC/RLS): resolve
 * cross-tenant theo `payment_ref` (@unique) trong service.
 *
 * An toàn:
 *  - CHỈ sống khi BILLING_GATEWAY='mock'; mode khác → 404 NOT_FOUND (không lộ chi
 *    tiết, kể cả với ref có thật) để prod manual không bao giờ auto-confirm.
 *  - Rate limit Redis INCR+EXPIRE theo (IP, ref), cửa sổ 60s → vượt 429 RATE_LIMITED.
 *  - Idempotent: tái dùng confirmPaymentByRef→confirmPayment (đã idempotent, không
 *    double-gia-hạn). Payload/response KHÔNG chứa PII khách — chỉ trạng thái payment.
 */
@Controller('public/billing/mock-gateway')
export class MockGatewayController {
  constructor(
    private readonly subscription: SubscriptionService,
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Post(':paymentRef/pay')
  @Public()
  @SkipTenantScope()
  @HttpCode(200)
  async pay(@Param('paymentRef') paymentRef: string, @Req() req: Request) {
    this.assertMockMode();
    // key theo (IP, paymentRef) — chống lạm dụng auto-confirm; áp TRƯỚC khi truy DB.
    await assertWithinRateLimit(
      this.redis,
      `mock-gw:pay:${req.ip ?? 'unknown'}`,
      paymentRef,
      RATE_LIMIT,
      RATE_WINDOW_SECONDS,
    );
    return { data: await this.subscription.confirmPaymentByRef(paymentRef) };
  }

  /** Endpoint chỉ tồn tại ở mode 'mock'. Mode khác → 404 (không tiết lộ endpoint). */
  private assertMockMode(): void {
    if (this.env.BILLING_GATEWAY !== 'mock') {
      throw new AppException({ code: 'NOT_FOUND', title: 'Không tìm thấy', status: 404 });
    }
  }
}
