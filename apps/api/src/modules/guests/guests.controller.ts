import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import {
  BlacklistGuestDto,
  CreateGuestDto,
  GuestListQueryDto,
  IdScanPresignDto,
  ScanIdDto,
  UpdateGuestDto,
} from './dto';
import { GuestsService } from './guests.service';

/**
 * /api/v1/guests — khách lưu trú (tenant-scoped, không theo property → chỉ pha-1 RBAC).
 * Số giấy tờ mã hoá (ADR-0007): list/get chỉ trả ****last4; xem đầy đủ qua
 * /:id/id-document (decrypt + audit READ_PII, quyền guest.pii.read).
 */
@Controller('guests')
export class GuestsController {
  constructor(private readonly guests: GuestsService) {}

  @Post()
  @RequirePermissions('booking.create')
  async create(@Body() dto: CreateGuestDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.guests.create(dto, user) };
  }

  /** Pre-sign upload ảnh CCCD lên storage tier VN (task 7.1). */
  @Post('id-scan/presign')
  @RequirePermissions('booking.create')
  @HttpCode(200)
  async presignIdScan(@Body() dto: IdScanPresignDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.guests.presignIdScan(dto, user) };
  }

  /** OCR scan CCCD/hộ chiếu (task 7.1) — trả extracted prefill, KHÔNG ghi DB. */
  @Post('scan-id')
  @RequirePermissions('booking.create')
  @HttpCode(200)
  async scanId(@Body() dto: ScanIdDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.guests.scanId(dto, user) };
  }

  @Get()
  @RequirePermissions('booking.read')
  async list(@Query() query: GuestListQueryDto, @CurrentUser() user: JwtClaims) {
    const { data, page_info } = await this.guests.list(user, query);
    return { data, page_info };
  }

  @Get(':id')
  @RequirePermissions('booking.read')
  async getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.guests.getById(id, user) };
  }

  /** Xem số giấy tờ đầy đủ — decrypt + audit READ_PII (quyền riêng). */
  @Get(':id/id-document')
  @RequirePermissions('guest.pii.read')
  async fullIdDocument(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.guests.getFullIdDocument(id, user) };
  }

  @Patch(':id')
  @RequirePermissions('booking.create')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGuestDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.guests.update(id, dto, user) };
  }

  @Delete(':id')
  @RequirePermissions('booking.create')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    await this.guests.remove(id, user);
  }

  @Post(':id/blacklist')
  @RequirePermissions('booking.update')
  async blacklist(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BlacklistGuestDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.guests.setBlacklist(id, true, user, dto) };
  }

  @Post(':id/unblacklist')
  @RequirePermissions('booking.update')
  async unblacklist(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.guests.setBlacklist(id, false, user) };
  }
}
