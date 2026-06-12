import { Body, Controller, Headers, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { CreatePaymentDto, RefundPaymentDto } from './dto';
import { PaymentsService } from './payments.service';

/** /api/v1/payments (docs/09 §5). Ghi nhận thủ công (cash/transfer) — SUCCEEDED ngay. */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @RequirePermissions('payment.record')
  async create(
    @Body() dto: CreatePaymentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.payments.record(dto, idempotencyKey, user) };
  }

  @Post(':id/refund')
  @RequirePermissions('payment.refund')
  @HttpCode(200)
  async refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundPaymentDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.payments.refund(id, dto, user) };
  }
}
