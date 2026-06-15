import { Body, Controller, Get, Patch } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { UpdateTenantDto } from './dto';
import { TenantService } from './tenant.service';

/**
 * /api/v1/tenant (task 6.7 S1) — hồ sơ tenant. GET: `tenant.read` (mọi role có);
 * PATCH: `tenant.update` (chỉ OWNER). Toàn tenant — không property-scope.
 */
@Controller('tenant')
export class TenantController {
  constructor(private readonly tenant: TenantService) {}

  @Get()
  @RequirePermissions('tenant.read')
  async get(@CurrentUser() user: JwtClaims) {
    return { data: await this.tenant.get(user) };
  }

  @Patch()
  @RequirePermissions('tenant.update')
  async update(@Body() dto: UpdateTenantDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.tenant.update(user, dto) };
  }
}
