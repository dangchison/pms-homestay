import { Module } from '@nestjs/common';
import { OccupancyModule } from '@modules/occupancy/occupancy.module';
import { PricingModule } from '@modules/pricing/pricing.module';
import { IdempotencyInterceptor } from '@core/http/interceptors/idempotency.interceptor';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

/**
 * Booking core (docs/06). createBookingTx dùng OccupancyService (occupancy),
 * PricingService (verify quote), DocumentCounterService (@Global) — đường ghi duy nhất.
 */
@Module({
  imports: [OccupancyModule, PricingModule],
  controllers: [BookingsController],
  providers: [BookingsService, IdempotencyInterceptor],
  exports: [BookingsService],
})
export class BookingsModule {}
