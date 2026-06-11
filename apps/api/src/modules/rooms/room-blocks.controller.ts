import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { CreateRoomBlockDto } from './dto';
import { RoomBlocksService } from './room-blocks.service';

/** /api/v1/room-blocks — chặn phòng (bảo trì/owner dùng). Đi qua occupancy (docs/06). */
@Controller('room-blocks')
export class RoomBlocksController {
  constructor(private readonly blocks: RoomBlocksService) {}

  @Post()
  @RequirePermissions('room.crud')
  async create(@Body() dto: CreateRoomBlockDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.blocks.create(dto, user) };
  }

  @Get()
  @RequirePermissions('property.read')
  async list(@Query('room_id', ParseUUIDPipe) roomId: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.blocks.list(roomId, user) };
  }

  @Delete(':id')
  @RequirePermissions('room.crud')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    await this.blocks.remove(id, user);
  }
}
