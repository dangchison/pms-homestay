import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_HOLD_EXPIRY } from '@core/bullmq/queues';
import { IdempotencyInterceptor } from '@core/http/interceptors/idempotency.interceptor';
import { CleaningModule } from '@modules/cleaning/cleaning.module';
import { ExpensesModule } from '@modules/expenses/expenses.module';
import { InvoicesModule } from '@modules/invoices/invoices.module';
import { OccupancyModule } from '@modules/occupancy/occupancy.module';
import { PricingModule } from '@modules/pricing/pricing.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { HoldExpiryProcessor } from './hold-expiry.cron';

/**
 * Booking core (docs/06). createBookingTx dùng OccupancyService (occupancy),
 * PricingService (verify quote), DocumentCounterService (@Global) — đường ghi duy nhất.
 * Queue `hold-expiry` (task 2.7): cron mỗi phút huỷ HOLD quá hạn.
 */
@Module({
  imports: [
    OccupancyModule,
    PricingModule,
    InvoicesModule,
    ExpensesModule,
    CleaningModule,
    BullModule.registerQueue({ name: QUEUE_HOLD_EXPIRY }),
  ],
  controllers: [BookingsController],
  providers: [BookingsService, IdempotencyInterceptor, HoldExpiryProcessor],
  exports: [BookingsService],
})
export class BookingsModule {}
