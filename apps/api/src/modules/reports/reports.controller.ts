import { Controller, Get, Query, Res } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { type Response } from 'express';
import { AuditExport } from '@core/http/decorators/audit-export.decorator';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import {
  AntiFraudQueryDto,
  BreakEvenQueryDto,
  LandlordStatementQueryDto,
  OccupancyReportQueryDto,
  PnlQueryDto,
} from './dto';
import { ReportsService } from './reports.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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

  /** Landlord statement (R2R) — báo cáo kỳ cho chủ nhà gốc (docs/16 #14). */
  @Get('landlord-statement')
  @RequirePermissions('report.financial')
  async landlordStatement(
    @Query() query: LandlordStatementQueryDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.reports.getLandlordStatement(query, user) };
  }

  /** Báo cáo anti-fraud (docs/16 #11, Wave 1) — 4 dấu hiệu gian lận tiền mặt, không PII. */
  @Get('anti-fraud')
  @RequirePermissions('report.financial')
  async antiFraud(@Query() query: AntiFraudQueryDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.reports.getAntiFraud(query, user) };
  }

  /** Xuất Excel (P&L + lấp đầy theo ngày) cho [from,to] — binary qua `@Res`. */
  @Get('export')
  @RequirePermissions('report.financial')
  @AuditExport() // B3: GET không tự audit → đánh dấu để ghi action EXPORT (docs/18).
  async exportXlsx(
    @Query() query: OccupancyReportQueryDto,
    @CurrentUser() user: JwtClaims,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.reports.exportXlsx(query, user);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }
}
