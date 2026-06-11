import { Global, Module } from '@nestjs/common';
import { DocumentCounterService } from './document-counter.service';

/** Sinh số chứng từ — dùng chung bookings (2.6) + invoices (3.2). */
@Global()
@Module({
  providers: [DocumentCounterService],
  exports: [DocumentCounterService],
})
export class CountersModule {}
