import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { type Request } from 'express';
import { ENV, type Env } from '@core/config/env.schema';
import { Public } from '@core/http/decorators/public.decorator';
import { SkipTenantScope } from '@core/http/decorators/skip-tenant.decorator';
import { AppException } from '@core/http/exceptions/app.exception';
import { PaymentWebhookDto } from './dto';
import { ReconciliationService } from './reconciliation.service';

/**
 * POST /api/v1/webhook/payment/:provider (docs/09 §5) — PUBLIC + SkipTenantScope
 * (chạy trước khi resolve tenant). HMAC verify (raw body) → dedup + enqueue → 200
 * ngay; worker đối soát bất đồng bộ.
 */
@Controller('webhook/payment')
export class PaymentWebhookController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @SkipTenantScope()
  @Post(':provider')
  @HttpCode(200)
  async receive(
    @Param('provider') provider: string,
    @Body() body: PaymentWebhookDto,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-signature') signature: string | undefined,
  ) {
    this.verifySignature(req.rawBody, signature);
    const { isNew } = await this.reconciliation.acceptWebhook(provider, body);
    return { received: true, duplicate: !isNew };
  }

  /** HMAC-SHA256(rawBody, secret) hex, so timing-safe với header x-signature. */
  private verifySignature(rawBody: Buffer | undefined, signature: string | undefined): void {
    const secret = this.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret) {
      throw new AppException({
        code: 'WEBHOOK_NOT_CONFIGURED',
        title: 'Webhook thanh toán chưa cấu hình secret',
        status: 503,
      });
    }
    if (!rawBody || !signature) {
      throw new AppException({ code: 'WEBHOOK_BAD_SIGNATURE', title: 'Thiếu chữ ký webhook', status: 401 });
    }
    const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new AppException({
        code: 'WEBHOOK_BAD_SIGNATURE',
        title: 'Chữ ký webhook không hợp lệ',
        status: 401,
      });
    }
  }
}
