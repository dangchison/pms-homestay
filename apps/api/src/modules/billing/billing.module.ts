import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { MeterReadingsController } from './meter-readings.controller';

/**
 * Billing thuê tháng (task 3.8). DocumentCounterService + PermissionService inject
 * toàn cục (@Global). Export BillingService cho night-audit 4.6 (runMonthlyBilling).
 */
@Module({
  controllers: [MeterReadingsController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
