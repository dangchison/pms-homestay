import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { type Request, type Response } from 'express';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { DataRightsService } from './data-rights.service';
import { DataCorrectionDto, GrantConsentDto } from './dto';

/**
 * Quyền chủ thể dữ liệu — Nghị định 13 (task 7.3, docs/12 §4). Routes dưới
 * /api/v1/guests/:id/... (controller riêng trong ComplianceModule, KHÔNG va chạm
 * GuestsController). Consent: booking.create/read; data-export/erasure: guest.pii.read
 * (đụng PII); correction: booking.create (uỷ thác guest update).
 */
@Controller('guests')
export class DataRightsController {
  constructor(private readonly dataRights: DataRightsService) {}

  @Get(':id/consents')
  @RequirePermissions('booking.read')
  async listConsents(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.dataRights.listConsents(id, user.tnt) };
  }

  @Post(':id/consents')
  @RequirePermissions('booking.create')
  async grantConsent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantConsentDto,
    @CurrentUser() user: JwtClaims,
    @Req() req: Request,
  ) {
    const ua = req.headers['user-agent'] ?? null;
    return { data: await this.dataRights.grantConsent(id, user.tnt, dto, req.ip ?? null, ua) };
  }

  @Post(':id/consents/:consentId/revoke')
  @RequirePermissions('booking.create')
  @HttpCode(200)
  async revokeConsent(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('consentId', ParseUUIDPipe) consentId: string,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.dataRights.revokeConsent(id, consentId, user.tnt) };
  }

  /** Right to Access/Portability — tải zip toàn bộ data của khách. */
  @Get(':id/data-export')
  @RequirePermissions('guest.pii.read')
  async dataExport(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtClaims,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.dataRights.exportGuestData(id, user.sub, user.tnt);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }

  /** Right to Erasure — ẩn danh + legal-hold matrix (giữ số giấy tờ tới hạn luật). */
  @Post(':id/data-erasure')
  @RequirePermissions('guest.pii.read')
  @HttpCode(200)
  async dataErasure(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.dataRights.eraseGuestData(id, user.sub, user.tnt) };
  }

  /** Right to Rectification — sửa thông tin khách. */
  @Post(':id/data-correction')
  @RequirePermissions('booking.create')
  @HttpCode(200)
  async dataCorrection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DataCorrectionDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.dataRights.correctGuestData(id, dto, user) };
  }
}
