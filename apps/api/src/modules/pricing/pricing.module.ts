import { Module } from '@nestjs/common';
import { DiscountsModule } from '@modules/discounts/discounts.module';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

/**
 * Export PricingService cho booking (2.6 verify quote) + night-audit (4.6 purge).
 * Import DiscountsModule để quote áp voucher (9.4c) qua DiscountsService.applyDiscountInTx —
 * một chiều (DiscountsModule KHÔNG import PricingModule) nên KHÔNG vòng phụ thuộc.
 */
@Module({
  imports: [DiscountsModule],
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
