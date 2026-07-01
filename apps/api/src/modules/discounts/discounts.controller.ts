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
} from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { CreateDiscountCodeDto, UpdateDiscountCodeDto } from './dto';
import { DiscountsService } from './discounts.service';

/**
 * /api/v1/discount-codes (Wave-1 #4, task 9.4b, docs/07 §7) — CRUD mã giảm giá.
 *
 * Mã giảm giá là tài nguyên TENANT-GLOBAL (mỗi tenant tự quản, applicable_property_ids
 * chỉ là bộ lọc áp dụng — KHÔNG phải sở hữu 1 property) → RBAC pha-1 theo role qua
 * `rate_plan.manage` (như cấu hình giá; OWNER/MANAGER có quyền). KHÔNG authorizeOnProperty
 * vì không có 1 property sở hữu. Cross-tenant chặn bởi guard (tenant match) + RLS.
 */
@Controller('discount-codes')
export class DiscountsController {
  constructor(private readonly discounts: DiscountsService) {}

  @Post()
  @RequirePermissions('rate_plan.manage')
  async create(@Body() dto: CreateDiscountCodeDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.discounts.create(dto, user) };
  }

  @Get()
  @RequirePermissions('rate_plan.manage')
  async list(@CurrentUser() user: JwtClaims) {
    return { data: await this.discounts.list(user) };
  }

  @Get(':id')
  @RequirePermissions('rate_plan.manage')
  async getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.discounts.getById(id, user) };
  }

  @Patch(':id')
  @RequirePermissions('rate_plan.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDiscountCodeDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.discounts.update(id, dto, user) };
  }

  @Delete(':id')
  @RequirePermissions('rate_plan.manage')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    await this.discounts.remove(id, user);
  }
}
