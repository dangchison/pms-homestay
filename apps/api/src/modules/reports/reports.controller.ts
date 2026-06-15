import { Controller, Get, Query } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { BreakEvenQueryDto, OccupancyReportQueryDto, PnlQueryDto } from './dto';
import { ReportsService } from './reports.service';

/**
 * /api/v1/reports — báo cáo tài chính (task 3.7, docs/09 §8/§10). Property-scoped:
 * pha-1 `report.financial` + pha-2 authorizeOnProperty. Đọc rollup daily_property_stats
 * (night-audit 4.6 fill) + live hôm nay; KHÔNG SUM real-time toàn kỳ.
 */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('pnl')
  @RequirePermissions('report.financial')
  async pnl(@Query() query: PnlQueryDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.reports.getPnl(query, user) };
  }

  @Get('break-even')
  @RequirePermissions('report.financial')
  async breakEven(@Query() query: BreakEvenQueryDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.reports.getBreakEven(query, user) };
  }

  @Get('occupancy')
  @RequirePermissions('report.financial')
  async occupancy(@Query() query: OccupancyReportQueryDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.reports.getOccupancy(query, user) };
  }
}
