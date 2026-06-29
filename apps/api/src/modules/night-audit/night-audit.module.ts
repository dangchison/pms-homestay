import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NIGHT_AUDIT } from '@core/bullmq/queues';
import { AssetsModule } from '@modules/assets/assets.module';
import { BillingModule } from '@modules/billing/billing.module';
import { ComplianceModule } from '@modules/compliance/compliance.module';
import { ExpensesModule } from '@modules/expenses/expenses.module';
import { InvoicesModule } from '@modules/invoices/invoices.module';
import { OccupancyModule } from '@modules/occupancy/occupancy.module';
import { SubscriptionModule } from '@modules/subscription/subscription.module';
import { MaintenanceService } from './maintenance.service';
import { NightAuditProcessor } from './night-audit.cron';
import { NightAuditService } from './night-audit.service';

/**
 * Night-audit (task 4.6). Gọi OccupancyService (giải phóng phòng) + service tháng
 * 3.5/3.6/3.8 (khấu hao/chi phí định kỳ/billing) + SubscriptionService lifecycle
 * sweep (4.7: trial→SUSPENDED→CHURNED). Queue `night-audit`: cron 02:00.
 */
@Module({
  imports: [
    OccupancyModule,
    AssetsModule,
    ExpensesModule,
    BillingModule,
    InvoicesModule,
    SubscriptionModule,
    ComplianceModule,
    BullModule.registerQueue({ name: QUEUE_NIGHT_AUDIT }),
  ],
  providers: [NightAuditService, MaintenanceService, NightAuditProcessor],
  exports: [NightAuditService, MaintenanceService],
})
export class NightAuditModule {}
