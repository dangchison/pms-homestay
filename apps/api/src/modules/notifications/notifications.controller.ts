import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { ListNotificationsDto } from './dto';
import { NotificationsService } from './notifications.service';

/**
 * /api/v1/notifications — inbox in-app của CHÍNH user (task 4.4). Không cần
 * @RequirePermissions: chỉ đọc/đánh dấu thông báo của bản thân (service lọc theo
 * user_id = token.sub).
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(@Query() query: ListNotificationsDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.notifications.listForUser(user, query) };
  }

  @Post(':id/read')
  @HttpCode(200)
  async markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.notifications.markRead(id, user) };
  }
}
