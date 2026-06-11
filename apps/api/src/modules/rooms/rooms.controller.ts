import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
import { AppException } from '@core/http/exceptions/app.exception';
import { CreateRoomDto, UpdateRoomDto } from './dto';
import { RoomsService } from './rooms.service';

/** If-Match header → version number (docs/05 §4.5). Hỗ trợ cả dạng có/không ngoặc kép. */
function parseIfMatch(raw?: string): number {
  if (!raw) {
    throw new AppException({
      code: 'IF_MATCH_REQUIRED',
      title: 'PATCH cần header If-Match = version hiện tại',
      status: 428,
    });
  }
  const n = Number(raw.replace(/^W\//, '').replace(/"/g, '').trim());
  if (!Number.isInteger(n) || n < 0) {
    throw new AppException({
      code: 'IF_MATCH_INVALID',
      title: 'If-Match không hợp lệ',
      status: 400,
    });
  }
  return n;
}

/** /api/v1/rooms (docs/05). Tạo phòng tự sinh resource ROOM (ADR-0006). */
@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Post()
  @RequirePermissions('room.crud')
  async create(@Body() dto: CreateRoomDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.rooms.create(dto, user) };
  }

  @Get()
  @RequirePermissions('property.read')
  async list(
    @Query('property_id', ParseUUIDPipe) propertyId: string,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.rooms.list(propertyId, user) };
  }

  @Get(':id')
  @RequirePermissions('property.read')
  async getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.rooms.getById(id, user) };
  }

  @Patch(':id')
  @RequirePermissions('room.crud')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: UpdateRoomDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.rooms.update(id, parseIfMatch(ifMatch), dto, user) };
  }

  @Delete(':id')
  @RequirePermissions('room.crud')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    await this.rooms.remove(id, user);
  }
}
