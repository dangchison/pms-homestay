import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_BILLING_GATEWAY } from '@core/bullmq/queues';
import { VietqrService } from '@modules/payments/vietqr.service';
import { PlatformAuthModule } from '@modules/platform-auth/platform-auth.module';
import { BillingGatewayProcessor } from './billing-gateway.processor';
import { MockGatewayController } from './mock-gateway.controller';
import { PlatformBillingController } from './platform-billing.controller';
import { PublicPlansController } from './public-plans.controller';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';

/**
 * Billing-lite SaaS (task 4.7). VietqrService (pure, stateless — re-provide ở
 * đây thay vì import PaymentsModule). TenantStatusService inject từ
 * TenantStatusModule (@Global). PlatformAuthModule: PlatformAuthGuard bảo vệ
 * endpoint confirm (B4 — thay PLATFORM_ADMIN_SECRET). Export SubscriptionService
 * cho Properties/Rooms (plan-limit guard) + NightAudit (lifecycle sweep).
 *
 * Đợt 4/M2: queue `billing-gateway` + BillingGatewayProcessor (cổng mock tự
 * confirm) + MockGatewayController (endpoint public sandbox, chỉ sống ở mode mock).
 */
@Module({
  imports: [PlatformAuthModule, BullModule.registerQueue({ name: QUEUE_BILLING_GATEWAY })],
  controllers: [
    SubscriptionController,
    PlatformBillingController,
    PublicPlansController,
    MockGatewayController,
  ],
  providers: [SubscriptionService, VietqrService, BillingGatewayProcessor],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
