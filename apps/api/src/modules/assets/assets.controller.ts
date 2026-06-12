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
import { AssetsService } from './assets.service';
import { AssetListQueryDto, CreateAssetDto, DisposeAssetDto, UpdateAssetDto } from './dto';

/**
 * /api/v1/assets — tài sản cố định + khấu hao (task 3.5, docs/09 §7).
 * Property-scoped: pha-1 RBAC `asset.crud` (decorator) + pha-2 authorizeOnProperty
 * (trong service, lấy property_id TỪ entity). Cron khấu hao tháng do night-audit
 * (task 4.6) gọi `AssetsService.runMonthlyDepreciation` — không có endpoint thủ công.
 */
@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post()
  @RequirePermissions('asset.crud')
  async create(@Body() dto: CreateAssetDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.assets.create(dto, user) };
  }

  @Get()
  @RequirePermissions('asset.crud')
  async list(@Query() query: AssetListQueryDto, @CurrentUser() user: JwtClaims) {
    const { data, page_info } = await this.assets.list(query.property_id, user, query);
    return { data, page_info };
  }

  @Get(':id')
  @RequirePermissions('asset.crud')
  async getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.assets.getById(id, user) };
  }

  /** Sổ khấu hao theo kỳ của tài sản. */
  @Get(':id/depreciation')
  @RequirePermissions('asset.crud')
  async depreciation(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.assets.listDepreciation(id, user) };
  }

  @Patch(':id')
  @RequirePermissions('asset.crud')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssetDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.assets.update(id, dto, user) };
  }

  /** Thanh lý tài sản (dừng khấu hao từ kỳ sau). */
  @Post(':id/dispose')
  @RequirePermissions('asset.crud')
  @HttpCode(200)
  async dispose(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DisposeAssetDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.assets.dispose(id, dto, user) };
  }

  @Delete(':id')
  @RequirePermissions('asset.crud')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    await this.assets.remove(id, user);
  }
}
