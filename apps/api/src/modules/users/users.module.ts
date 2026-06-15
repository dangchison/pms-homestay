import { Module } from '@nestjs/common';
import { AuthPublicModule } from '@modules/auth-public/auth-public.module';
import { SubscriptionModule } from '@modules/subscription/subscription.module';
import { UserPropertyRolesController } from './user-property-roles.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Users & per-property roles (task 6.7 S2). SubscriptionModule: plan-limit khi mời
 * (task 4.7). AuthPublicModule: tái dùng forgotPassword gửi email đặt mật khẩu.
 * PermissionService @Global (bump version khi đổi role).
 */
@Module({
  imports: [SubscriptionModule, AuthPublicModule],
  controllers: [UsersController, UserPropertyRolesController],
  providers: [UsersService],
})
export class UsersModule {}
