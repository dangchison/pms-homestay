import { Module } from '@nestjs/common';
import { VietqrService } from '@modules/payments/vietqr.service';
import { PlatformBillingController } from './platform-billing.controller';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';

/**
 * Billing-lite SaaS (task 4.7). VietqrService (pure, stateless — re-provide ở
 * đây thay vì import PaymentsModule). TenantStatusService inject từ
 * TenantStatusModule (@Global). Export SubscriptionService cho Properties/Rooms
 * (plan-limit guard) + NightAudit (lifecycle sweep).
 */
@Module({
  controllers: [SubscriptionController, PlatformBillingController],
  providers: [SubscriptionService, VietqrService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
