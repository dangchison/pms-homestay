import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

/**
 * Invoices (docs/09 §4, task 3.2). InvoicesService dùng DocumentCounterService
 * (@Global) + PermissionService. KHÔNG phụ thuộc BookingsService — BookingsModule
 * import module này để issue DEPOSIT/STAY + markDepositPaid (luồng một chiều).
 */
@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
