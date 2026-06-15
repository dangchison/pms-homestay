import { Controller, Get, Query } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { CalendarService } from './calendar.service';
import { CalendarOccupancyQueryDto } from './dto';

/**
 * /api/v1/occupancy (task 6.2, spec ui/01 #C1) — nguồn dữ liệu calendar timeline.
 * Đọc-only; property-scoped (pha-2 authorizeOnProperty trong service).
 */
@Controller('occupancy')
export class OccupancyController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  @RequirePermissions('booking.read')
  async getOccupancy(@Query() query: CalendarOccupancyQueryDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.calendar.getOccupancy(query, user) };
  }
}
