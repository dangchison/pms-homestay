import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { CreatePaymentDto, RefundPaymentDto, ResolveUnmatchedDto } from './dto';
import { PaymentsService } from './payments.service';
import { ReconciliationService } from './reconciliation.service';

/** /api/v1/payments (docs/09 §5). Ghi nhận thủ công (cash/transfer) + đối soát (3.4). */
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  // ── Đối soát thủ công (unmatched) — khai báo TRƯỚC route :id để không bị nuốt ──

  @Get('unmatched')
  @RequirePermissions('payment.reconcile')
  async listUnmatched(@CurrentUser() user: JwtClaims) {
    return { data: await this.reconciliation.listUnmatched(user) };
  }

  @Post('unmatched/:id/resolve')
  @RequirePermissions('payment.reconcile')
  @HttpCode(200)
  async resolveUnmatched(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveUnmatchedDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.reconciliation.resolve(id, dto.invoice_id, user) };
  }

  @Post('unmatched/:id/ignore')
  @RequirePermissions('payment.reconcile')
  @HttpCode(200)
  async ignoreUnmatched(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.reconciliation.ignore(id, user) };
  }

  /** Liệt kê payment của 1 hoá đơn (task 6.4, F2) — `?invoice_id=`. */
  @Get()
  @RequirePermissions('invoice.read')
  async listByInvoice(
    @Query('invoice_id', ParseUUIDPipe) invoiceId: string,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.payments.listByInvoice(invoiceId, user) };
  }

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
