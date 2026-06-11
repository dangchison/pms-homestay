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
import { OffsetPaginationQueryDto } from '@/shared/dto';
import { CreatePropertyDto, UpdatePropertyDto } from './dto';
import { PropertiesService } from './properties.service';

/** /api/v1/properties (docs/05). Pha-1 RBAC qua guard; pha-2 property-scope trong service. */
@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Post()
  @RequirePermissions('property.create')
  async create(@Body() dto: CreatePropertyDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.properties.create(dto, user) };
  }

  @Get()
  @RequirePermissions('property.read')
  async list(@Query() query: OffsetPaginationQueryDto, @CurrentUser() user: JwtClaims) {
    const { data, page_info } = await this.properties.list(user, query);
    return { data, page_info };
  }

  @Get(':id')
  @RequirePermissions('property.read')
  async getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.properties.getById(id, user) };
  }

  @Patch(':id')
  @RequirePermissions('property.update')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.properties.update(id, dto, user) };
  }

  @Delete(':id')
  @RequirePermissions('property.delete')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    await this.properties.remove(id, user);
  }
}
