import { Module } from '@nestjs/common';
import { PlatformAuthModule } from '@modules/platform-auth/platform-auth.module';
import { SubscriptionModule } from '@modules/subscription/subscription.module';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';

/**
 * Bảng điều khiển nền tảng (web-platform): cấu hình gói, tenant, thanh toán.
 * PlatformAuthModule cấp PlatformAuthGuard; SubscriptionModule cấp getSummary
 * (usage phải đi qua withTenant vì RLS). TenantStatusService/PlanFeatureService
 * đến từ module @Global.
 */
@Module({
  imports: [PlatformAuthModule, SubscriptionModule],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService],
})
export class PlatformAdminModule {}
