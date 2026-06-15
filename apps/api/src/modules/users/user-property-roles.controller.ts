import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { AssignPropertyRoleDto, UpdatePropertyRoleDto } from './dto';
import { UsersService } from './users.service';

/**
 * /api/v1/user-property-roles (task 6.7 S2) — gán role per-property + override
 * grant/deny. Quyền `user.manage_roles` (OWNER). Tách controller riêng để URL gọn
 * (không lồng dưới /users/:id).
 */
@Controller('user-property-roles')
export class UserPropertyRolesController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @RequirePermissions('user.manage_roles')
  async assign(@Body() dto: AssignPropertyRoleDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.users.assignPropertyRole(dto, user) };
  }

  @Patch(':id')
  @RequirePermissions('user.manage_roles')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyRoleDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.users.updatePropertyRole(id, dto, user) };
  }

  @Delete(':id')
  @RequirePermissions('user.manage_roles')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    await this.users.deletePropertyRole(id, user);
  }
}
