import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { type Response } from 'express';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { SkipAudit } from '@core/http/decorators/skip-audit.decorator';
import { RequirePlanFeature } from '@core/billing/plan-feature';
import {
  CreateForeignResidenceDto,
  ForeignResidenceListQueryDto,
  UpdateForeignResidenceDto,
} from './dto';
import { ForeignResidenceService } from './foreign-residence.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * /api/v1/compliance/foreign-residence — khai báo tạm trú khách nước ngoài (mẫu NA17,
 * XNC) — task 9.3, docs/12 §2. Số thị thực mã hoá field; list/get chỉ trả last4, phiếu
 * NA17 mới giải mã (+ audit READ_PII). Quyền `guest.pii.read` (pha-1) + property-scope
 * (pha-2 trong service) — như báo cáo lưu trú TT56.
 */
@Controller('compliance/foreign-residence')
@RequirePlanFeature('compliance')
export class ForeignResidenceController {
  constructor(private readonly service: ForeignResidenceService) {}

  @Post()
  @RequirePermissions('guest.pii.read')
  async create(@Body() dto: CreateForeignResidenceDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.service.create(dto, user) };
  }

  @Get()
  @RequirePermissions('guest.pii.read')
  async list(@Query() query: ForeignResidenceListQueryDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.service.list(query, user) };
  }

  @Get(':id')
  @RequirePermissions('guest.pii.read')
  async getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.service.getById(id, user) };
  }

  @Patch(':id')
  @RequirePermissions('guest.pii.read')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateForeignResidenceDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.service.update(id, dto, user) };
  }

  /** "Gửi" khai báo lên XNC (Phase 1 STUB) — service ghi audit STATE_CHANGE tường minh. */
  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('guest.pii.read')
  @SkipAudit()
  async submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.service.submit(id, user) };
  }

  /** Xuất phiếu NA17 (.xlsx) — giải mã visa + hộ chiếu (binary qua @Res + audit READ_PII). */
  @Get(':id/na17')
  @RequirePermissions('guest.pii.read')
  async na17(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtClaims,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.service.generateNa17(id, user);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }
}
