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
  Put,
  Query,
} from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import {
  AssignResourcesDto,
  CreateRatePlanDto,
  CreateRatePlanRuleDto,
  RatePlanListQueryDto,
  UpdateRatePlanDto,
  UpdateRatePlanRuleDto,
} from './dto';
import { RatePlansService } from './rate-plans.service';

/** /api/v1/rate-plans (docs/07). Đọc cần property.read; cấu hình cần rate_plan.manage. */
@Controller('rate-plans')
export class RatePlansController {
  constructor(private readonly ratePlans: RatePlansService) {}

  @Post()
  @RequirePermissions('rate_plan.manage')
  async create(@Body() dto: CreateRatePlanDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.ratePlans.create(dto, user) };
  }

  @Get()
  @RequirePermissions('property.read')
  async list(@Query() query: RatePlanListQueryDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.ratePlans.list(query.property_id, user, query.mode) };
  }

  @Get(':id')
  @RequirePermissions('property.read')
  async getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.ratePlans.getById(id, user) };
  }

  @Patch(':id')
  @RequirePermissions('rate_plan.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRatePlanDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.ratePlans.update(id, dto, user) };
  }

  @Delete(':id')
  @RequirePermissions('rate_plan.manage')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    await this.ratePlans.remove(id, user);
  }

  @Put(':id/resources')
  @RequirePermissions('rate_plan.manage')
  async assignResources(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignResourcesDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.ratePlans.assignResources(id, dto, user) };
  }

  // ── Rules ──────────────────────────────────────────────────────────────────

  @Get(':id/rules')
  @RequirePermissions('property.read')
  async listRules(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.ratePlans.listRules(id, user) };
  }

  @Post(':id/rules')
  @RequirePermissions('rate_plan.manage')
  async createRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRatePlanRuleDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.ratePlans.createRule(id, dto, user) };
  }

  @Patch(':id/rules/:ruleId')
  @RequirePermissions('rate_plan.manage')
  async updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body() dto: UpdateRatePlanRuleDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.ratePlans.updateRule(id, ruleId, dto, user) };
  }

  @Delete(':id/rules/:ruleId')
  @RequirePermissions('rate_plan.manage')
  @HttpCode(204)
  async removeRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentUser() user: JwtClaims,
  ) {
    await this.ratePlans.removeRule(id, ruleId, user);
  }
}
