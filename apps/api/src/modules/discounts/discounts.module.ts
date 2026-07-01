import { Module } from '@nestjs/common';
import { DiscountsController } from './discounts.controller';
import { DiscountsService } from './discounts.service';

/**
 * Mã giảm giá / khuyến mãi (Wave-1 #4, task 9.4b). CRUD tenant-scoped + applyDiscount
 * (logic thuần) + redeemInTx (atomic, tăng used_count trong tx booking). Export
 * DiscountsService cho BookingsModule (redeem trong createBookingTx). KHÔNG import
 * BookingsModule (tránh vòng phụ thuộc — discounts độc lập).
 */
@Module({
  controllers: [DiscountsController],
  providers: [DiscountsService],
  exports: [DiscountsService],
})
export class DiscountsModule {}
