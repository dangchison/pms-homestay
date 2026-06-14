import { Controller, Delete, HttpCode, Param, ParseUUIDPipe, Patch, Post, Body } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { ChannelsService } from './channels.service';
import { UpdateChannelMappingDto } from './dto';
import { IcalSyncService } from './ical-sync.service';

/**
 * /api/v1/channel-mappings/:id — thao tác trên 1 mapping (task 5.1). Tách path
 * riêng để tránh va chạm route với /channels/:id. Quyền `channel.manage` + pha-2
 * authorizeOnProperty (property_id từ channel của mapping).
 */
@Controller('channel-mappings')
export class ChannelMappingsController {
  constructor(
    private readonly channels: ChannelsService,
    private readonly icalSync: IcalSyncService,
  ) {}

  @Patch(':id')
  @RequirePermissions('channel.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChannelMappingDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.channels.updateMapping(id, dto, user) };
  }

  @Delete(':id')
  @RequirePermissions('channel.manage')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    await this.channels.removeMapping(id, user);
  }

  /** Sinh lại ical_push_token (thu hồi token cũ). */
  @Post(':id/regenerate-token')
  @RequirePermissions('channel.manage')
  @HttpCode(200)
  async regenerateToken(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.channels.regenerateToken(id, user) };
  }

  /** Sync ngay (task 5.2) — fetch iCal pull URL + áp feed. */
  @Post(':id/sync')
  @RequirePermissions('channel.manage')
  @HttpCode(200)
  async syncNow(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    await this.channels.assertCanManageMapping(id, user);
    return { data: await this.icalSync.syncMapping(user.tnt, id) };
  }
}
