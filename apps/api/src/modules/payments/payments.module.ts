import { Module } from '@nestjs/common';
import { BookingsModule } from '@modules/bookings/bookings.module';
import { InvoicesModule } from '@modules/invoices/invoices.module';
import { InvoiceQrController } from './invoice-qr.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { VietqrService } from './vietqr.service';

/**
 * Payments (docs/09 §5, task 3.3). Tầng trên: import InvoicesModule (đọc/validate
 * invoice) + BookingsModule (confirm khi cọc trả đủ) — một chiều, không circular
 * (Bookings→Invoices; Payments→{Bookings,Invoices}).
 */
@Module({
  imports: [InvoicesModule, BookingsModule],
  controllers: [PaymentsController, InvoiceQrController],
  providers: [PaymentsService, VietqrService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
