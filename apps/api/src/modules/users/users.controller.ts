import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { InviteUserDto, UpdateUserDto } from './dto';
import { UsersService } from './users.service';

/**
 * /api/v1/users (task 6.7 S2) — quản lý nhân sự tenant. Liệt kê/sửa role:
 * `user.manage_roles`; mời: `user.invite` (đều chỉ OWNER mặc định). Toàn tenant.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('user.manage_roles')
  async list(@CurrentUser() user: JwtClaims) {
    return { data: await this.users.list(user) };
  }

  @Post()
  @RequirePermissions('user.invite')
  async invite(@Body() dto: InviteUserDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.users.invite(dto, user) };
  }

  @Get(':id')
  @RequirePermissions('user.manage_roles')
  async getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.users.getById(id, user) };
  }

  @Patch(':id')
  @RequirePermissions('user.manage_roles')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.users.update(id, dto, user) };
  }

  @Get(':id/property-roles')
  @RequirePermissions('user.manage_roles')
  async propertyRoles(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.users.listPropertyRoles(id, user) };
  }
}
