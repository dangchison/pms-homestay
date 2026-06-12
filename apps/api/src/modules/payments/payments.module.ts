import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_PAYMENT_RECONCILE } from '@core/bullmq/queues';
import { BookingsModule } from '@modules/bookings/bookings.module';
import { InvoicesModule } from '@modules/invoices/invoices.module';
import { InvoiceQrController } from './invoice-qr.controller';
import { PaymentReconcileProcessor } from './payment-reconcile.processor';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ReconciliationService } from './reconciliation.service';
import { VietqrService } from './vietqr.service';

/**
 * Payments + đối soát (docs/09 §5, task 3.3+3.4). Tầng trên: import InvoicesModule
 * + BookingsModule (một chiều, không circular). Queue `payment-reconcile`: webhook
 * enqueue → worker đối soát bất đồng bộ.
 */
@Module({
  imports: [
    InvoicesModule,
    BookingsModule,
    BullModule.registerQueue({ name: QUEUE_PAYMENT_RECONCILE }),
  ],
  controllers: [PaymentsController, InvoiceQrController, PaymentWebhookController],
  providers: [PaymentsService, VietqrService, ReconciliationService, PaymentReconcileProcessor],
  exports: [PaymentsService],
})
export class PaymentsModule {}
