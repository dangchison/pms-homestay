import { Controller, Get, Query, Res } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { type Response } from 'express';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { ComplianceService } from './compliance.service';
import { PoliceReportQueryDto } from './dto';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * /api/v1/compliance — tuân thủ pháp lý VN (task 7.2, docs/12 §2). Báo cáo lưu trú
 * công an: tải file Excel (binary qua `@Res`). Quyền `guest.pii.read` (pha-1) +
 * property-scope (pha-2 trong service) vì giải mã số giấy tờ (PII nhạy cảm).
 */
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('police-report')
  @RequirePermissions('guest.pii.read')
  async policeReport(
    @Query() query: PoliceReportQueryDto,
    @CurrentUser() user: JwtClaims,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.compliance.generatePoliceReport(query, user);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }
}
