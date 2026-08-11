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
import { RequirePlanFeature } from '@core/billing/plan-feature';
import { ChannelsService } from './channels.service';
import {
  ChannelListQueryDto,
  CreateChannelDto,
  CreateChannelMappingDto,
  UpdateChannelDto,
} from './dto';
import { IcalSyncService } from './ical-sync.service';

/**
 * /api/v1/channels — kênh OTA + listing mapping (task 5.1, docs/03 §4.8).
 * Property-scoped: pha-1 `channel.manage` (OWNER/MANAGER) + pha-2
 * authorizeOnProperty (service, property_id từ channel). Mapping item ops ở
 * ChannelMappingsController (/channel-mappings/:id).
 */
@Controller('channels')
@RequirePlanFeature('ota_sync')
export class ChannelsController {
  constructor(
    private readonly channels: ChannelsService,
    private readonly icalSync: IcalSyncService,
  ) {}

  @Post()
  @RequirePermissions('channel.manage')
  async create(@Body() dto: CreateChannelDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.channels.createChannel(dto, user) };
  }

  @Get()
  @RequirePermissions('channel.manage')
  async list(@Query() query: ChannelListQueryDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.channels.listChannels(query.property_id, user) };
  }

  /** Số xung đột OTA gần đây (Dashboard alert). Khai BEFORE `:id` (Nest match theo thứ tự). */
  @Get('conflict-count')
  @RequirePermissions('channel.manage')
  async conflictCount(@Query() query: ChannelListQueryDto, @CurrentUser() user: JwtClaims) {
    return { data: { conflict_count: await this.channels.countRecentConflicts(query.property_id, user) } };
  }

  @Get(':id')
  @RequirePermissions('channel.manage')
  async getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.channels.getChannel(id, user) };
  }

  @Patch(':id')
  @RequirePermissions('channel.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChannelDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.channels.updateChannel(id, dto, user) };
  }

  @Delete(':id')
  @RequirePermissions('channel.manage')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    await this.channels.removeChannel(id, user);
  }

  // ── Mappings nested dưới channel (tạo/liệt kê) ──────────────────────────────
  @Post(':id/mappings')
  @RequirePermissions('channel.manage')
  async createMapping(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateChannelMappingDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.channels.createMapping(id, dto, user) };
  }

  @Get(':id/mappings')
  @RequirePermissions('channel.manage')
  async listMappings(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.channels.listMappings(id, user) };
  }

  /** Lịch sử sync job của kênh (task 5.2). */
  @Get(':id/sync-jobs')
  @RequirePermissions('channel.manage')
  async syncJobs(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    await this.channels.assertCanManageChannel(id, user);
    return { data: await this.icalSync.listJobs(user.tnt, id) };
  }
}
