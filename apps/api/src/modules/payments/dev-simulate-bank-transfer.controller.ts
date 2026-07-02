import { randomUUID } from 'node:crypto';
import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { type PaymentWebhook, PaymentWebhookSchema } from '@pms/shared-types';
import { type Request } from 'express';
import type Redis from 'ioredis';
import { ENV, type Env } from '@core/config/env.schema';
import { Public } from '@core/http/decorators/public.decorator';
import { SkipTenantScope } from '@core/http/decorators/skip-tenant.decorator';
import { AppException } from '@core/http/exceptions/app.exception';
import { assertWithinRateLimit } from '@core/redis/rate-limit';
import { REDIS } from '@core/redis/redis.module';
import { SimulateBankTransferDto } from './dto';
import { ReconciliationService } from './reconciliation.service';

/** Rate limit endpoint giả lập chuyển khoản: n lần / cửa sổ / (IP, event_id). */
const RATE_LIMIT = 10;
const RATE_WINDOW_SECONDS = 60;

/**
 * POST /api/v1/dev/simulate-bank-transfer (Đợt 4/M4 — dev-only) — giả lập 1 giao
 * dịch chuyển khoản ngân hàng để KHÉP VÒNG đối soát demo hosted booking KHÔNG cần
 * cổng/creds thật. `@Public` (bỏ JWT) + `@SkipTenantScope` (bỏ tenant GUC/RLS):
 * ReconciliationService tự resolve tenant cross-tenant theo `bank_account`.
 *
 * An toàn (HARD-GATE):
 *  - CHỈ sống khi DEMO_TOOLS_ENABLED=true; mặc định false → 404 NOT_FOUND (không lộ
 *    chi tiết, kể cả với bank_account & mã BK-/INV- có thật) — endpoint VÔ HÌNH ở prod
 *    để manual không bao giờ auto-confirm. 404 (KHÔNG 403) để không tiết lộ tồn tại.
 *  - Rate limit Redis INCR+EXPIRE theo (IP, event_id), cửa sổ 60s → vượt 429 RATE_LIMITED.
 *
 * Khép vòng ĐỒNG BỘ: worker off ở dev/e2e nên gọi acceptWebhook (dedup+enqueue) rồi
 * reconcile (resolve tenant → match → auto-confirm/unmatched) NGAY trong 1 request —
 * KHÁC đường async prod, chỉ THÊM caller mới (không đổi PaymentWebhookController/
 * ReconciliationService). Response CHỈ trạng thái + mã (BK-/INV-), KHÔNG PII khách.
 */
@Controller('dev')
export class DevSimulateBankTransferController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Post('simulate-bank-transfer')
  @Public()
  @SkipTenantScope()
  @HttpCode(200)
  async simulate(@Body() dto: SimulateBankTransferDto, @Req() req: Request) {
    this.assertDemoEnabled();

    const eventId = dto.event_id ?? randomUUID();
    // key theo (IP, event_id) — chống lạm dụng; áp TRƯỚC khi truy DB.
    await assertWithinRateLimit(
      this.redis,
      `dev-sim-ck:${req.ip ?? 'unknown'}`,
      eventId,
      RATE_LIMIT,
      RATE_WINDOW_SECONDS,
    );

    // Chuẩn hoá về PaymentWebhook (đúng khuôn worker đối soát) + validate lại qua schema.
    const payload: PaymentWebhook = PaymentWebhookSchema.parse({
      event_id: eventId,
      amount_vnd: dto.amount_vnd,
      content: this.buildContent(dto),
      bank_account: dto.bank_account,
      received_at: new Date().toISOString(),
    });

    // Worker off (dev-only) → chạy đồng bộ để khép vòng ngay trong 1 request.
    await this.reconciliation.acceptWebhook(dto.provider, payload);
    const { matched } = await this.reconciliation.reconcile(dto.provider, payload);
    return { data: { matched, event_id: eventId } };
  }

  /** content tường minh nếu có; else tự dựng từ booking_code/invoice_number (tiện demo). */
  private buildContent(dto: SimulateBankTransferDto): string {
    if (dto.content) return dto.content;
    if (dto.invoice_number) return `Thanh toan hoa don ${dto.invoice_number}`;
    if (dto.booking_code) return `Thanh toan dat phong ${dto.booking_code}`;
    return '';
  }

  /** Endpoint chỉ tồn tại khi DEMO_TOOLS_ENABLED=true. Else → 404 (không tiết lộ). */
  private assertDemoEnabled(): void {
    if (this.env.DEMO_TOOLS_ENABLED === false) {
      throw new AppException({ code: 'NOT_FOUND', title: 'Không tìm thấy', status: 404 });
    }
  }
}
