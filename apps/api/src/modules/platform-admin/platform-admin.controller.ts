import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { type PlatformClaims } from '@pms/shared-types';
import { Public } from '@core/http/decorators/public.decorator';
import { SkipTenantScope } from '@core/http/decorators/skip-tenant.decorator';
import { CurrentPlatformAdmin } from '@modules/platform-auth/current-platform-admin.decorator';
import { PlatformAuthGuard } from '@modules/platform-auth/platform-auth.guard';
import {
  CreatePlanDto,
  PaymentListQueryDto,
  TenantListQueryDto,
  UpdatePlanDto,
  UpdateTenantDto,
} from './dto';
import { PlatformAdminService } from './platform-admin.service';

/**
 * /api/v1/platform/{plans,tenants,subscription-payments} — bảng điều khiển nền
 * tảng (web-platform). Cùng khuôn với PlatformBillingController: `@Public` +
 * `@SkipTenantScope` để bỏ JwtAuthGuard/TenantGuard của tenant, auth thật do
 * `PlatformAuthGuard` (secret riêng + claim `typ: 'platform'`).
 *
 * Guard đặt ở CLASS nên mọi route dưới đây đều được bảo vệ — thêm route mới
 * không thể quên gác nhầm.
 */
@Controller('platform')
@Public()
@SkipTenantScope()
@UseGuards(PlatformAuthGuard)
export class PlatformAdminController {
  constructor(private readonly platform: PlatformAdminService) {}

  // ── Gói ─────────────────────────────────────────────────────────────────────

  @Get('plans')
  async listPlans() {
    return { data: await this.platform.listPlans() };
  }

  @Post('plans')
  async createPlan(@Body() dto: CreatePlanDto, @CurrentPlatformAdmin() admin?: PlatformClaims) {
    return { data: await this.platform.createPlan(dto, admin?.eml ?? 'unknown') };
  }

  @Patch('plans/:id')
  async updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentPlatformAdmin() admin?: PlatformClaims,
  ) {
    return { data: await this.platform.updatePlan(id, dto, admin?.eml ?? 'unknown') };
  }

  // ── Tenant ──────────────────────────────────────────────────────────────────

  @Get('tenants')
  async listTenants(@Query() query: TenantListQueryDto) {
    return { data: await this.platform.listTenants(query) };
  }

  @Get('tenants/:id')
  async getTenant(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.platform.getTenantDetail(id) };
  }

  @Patch('tenants/:id')
  async updateTenant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantDto,
    @CurrentPlatformAdmin() admin?: PlatformClaims,
  ) {
    return { data: await this.platform.updateTenant(id, dto, admin?.eml ?? 'unknown') };
  }

  // ── Thanh toán thuê bao ─────────────────────────────────────────────────────

  @Get('subscription-payments')
  async listPayments(@Query() query: PaymentListQueryDto) {
    return { data: await this.platform.listPayments(query) };
  }
}
