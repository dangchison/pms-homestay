import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { ListNotificationsDto, ListOutboundMessagesDto } from './dto';
import { NotificationsService } from './notifications.service';
import { OutboundMessagesService } from './outbound-messages.service';

/**
 * /api/v1/notifications — inbox in-app của CHÍNH user (task 4.4). Không cần
 * @RequirePermissions: chỉ đọc/đánh dấu thông báo của bản thân (service lọc theo
 * user_id = token.sub). GET /outbound (M1) là sổ gửi kênh ngoài — gated audit_log.read.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly outbound: OutboundMessagesService,
  ) {}

  @Get()
  async list(@Query() query: ListNotificationsDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.notifications.listForUser(user, query) };
  }

  /**
   * Sổ gửi kênh ngoài (Đợt 4 / M1) — tenant-scoped, quyền audit_log.read (OWNER +
   * ACCOUNTANT). Lọc ?channel=SMS|ZNS|EMAIL + ?limit. Route static 'outbound' đứng
   * trước @Post(':id/read') nên không đụng param.
   */
  @Get('outbound')
  @RequirePermissions('audit_log.read')
  async listOutbound(@Query() query: ListOutboundMessagesDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.outbound.listOutbound(user, query) };
  }

  @Post(':id/read')
  @HttpCode(200)
  async markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.notifications.markRead(id, user) };
  }
}
