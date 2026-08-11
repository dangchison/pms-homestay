import { Global, Module } from '@nestjs/common';
import { PlanFeatureService } from './plan-feature.service';

/**
 * @Global — PlanFeatureService dùng bởi PlanFeatureGuard (global guard) +
 * SubscriptionService (invalidate sau khi đổi gói). PrismaService/REDIS sẵn (global).
 */
@Global()
@Module({
  providers: [PlanFeatureService],
  exports: [PlanFeatureService],
})
export class PlanFeatureModule {}
