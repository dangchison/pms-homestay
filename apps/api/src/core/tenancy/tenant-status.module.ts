import { Global, Module } from '@nestjs/common';
import { TenantStatusService } from './tenant-status.service';

/**
 * @Global — TenantStatusService dùng bởi TenantStatusGuard (global guard) +
 * SubscriptionService (invalidate sau confirm). PrismaService/REDIS sẵn (global).
 */
@Global()
@Module({
  providers: [TenantStatusService],
  exports: [TenantStatusService],
})
export class TenantStatusModule {}
