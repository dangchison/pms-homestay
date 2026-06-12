import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { BillingService } from './billing.service';
import { MeterReadingListQueryDto, RecordMeterReadingDto } from './dto';

/**
 * /api/v1/meter-readings — chỉ số điện/nước thuê tháng (task 3.8). Staff ghi
 * (`booking.update`) → job billing-cycle (night-audit 4.6 gọi
 * BillingService.runMonthlyBilling) đọc để sinh invoice MONTHLY_RENT.
 */
@Controller('meter-readings')
export class MeterReadingsController {
  constructor(private readonly billing: BillingService) {}

  @Post()
  @RequirePermissions('booking.update')
  async record(@Body() dto: RecordMeterReadingDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.billing.recordMeterReading(dto, user) };
  }

  @Get()
  @RequirePermissions('booking.read')
  async list(@Query() query: MeterReadingListQueryDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.billing.listReadings(query.booking_id, user) };
  }
}
