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
import { CreateWholeResourceDto, UpdateResourceDto } from './dto';
import { ResourcesService } from './resources.service';

/**
 * /api/v1/bookable-resources (ADR-0006). Resource WHOLE (nguyên căn) tạo/sửa
 * tại đây; resource ROOM tự sinh khi tạo phòng (xem RoomsService).
 * Đọc cần property.read; cấu hình cần resource.crud.
 */
@Controller('bookable-resources')
export class ResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  @Post()
  @RequirePermissions('resource.crud')
  async createWhole(@Body() dto: CreateWholeResourceDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.resources.createWhole(dto, user) };
  }

  @Get()
  @RequirePermissions('property.read')
  async list(
    @Query('property_id', ParseUUIDPipe) propertyId: string,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.resources.list(propertyId, user) };
  }

  @Get(':id')
  @RequirePermissions('property.read')
  async getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.resources.getById(id, user) };
  }

  @Patch(':id')
  @RequirePermissions('resource.crud')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateResourceDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.resources.update(id, dto, user) };
  }

  @Delete(':id')
  @RequirePermissions('resource.crud')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    await this.resources.remove(id, user);
  }
}
