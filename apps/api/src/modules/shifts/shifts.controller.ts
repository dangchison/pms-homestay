import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { RequirePlanFeature } from '@core/billing/plan-feature';
import { CloseShiftDto, OpenShiftDto, ShiftsListQueryDto } from './dto';
import { ShiftsService } from './shifts.service';

/**
 * /api/v1/shifts (task 9.4, docs/16 #10 — Wave 1 chống thất thoát tiền mặt). Sổ quỹ ca:
 * mở/đóng ca cần `payment.reconcile` (+ pha-2 authorizeOnProperty) — người mở/đóng ca
 * là OWNER/ACCOUNTANT và STAFF (thu ngân, task 2.10a); đọc (list/detail) cần
 * `report.financial` nên STAFF vẫn KHÔNG đọc được ca.
 */
@Controller('shifts')
@RequirePlanFeature('shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Post()
  @RequirePermissions('payment.reconcile')
  async open(
    @Body() dto: OpenShiftDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.shifts.open(dto, idempotencyKey, user) };
  }

  @Get()
  @RequirePermissions('report.financial')
  async list(@Query() query: ShiftsListQueryDto, @CurrentUser() user: JwtClaims) {
    return this.shifts.list(query, user); // { data, page_info }
  }

  @Get(':id')
  @RequirePermissions('report.financial')
  async getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.shifts.getDetail(id, user) };
  }

  @Post(':id/close')
  @RequirePermissions('payment.reconcile')
  @HttpCode(200)
  async close(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: CloseShiftDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.shifts.close(id, ifMatch, dto, user) };
  }
}
