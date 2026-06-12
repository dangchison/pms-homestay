import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type PaymentWebhook } from '@pms/shared-types';
import { type Job } from 'bullmq';
import { QUEUE_PAYMENT_RECONCILE } from '@core/bullmq/queues';
import { ENV, type Env } from '@core/config/env.schema';
import { ReconciliationService } from './reconciliation.service';

interface ReconcileJob {
  provider: string;
  payload: PaymentWebhook;
}

/**
 * Worker đối soát thanh toán (task 3.4) — tiêu thụ queue payment-reconcile (event-
 * driven, không cron). `autorun:false` + chạy khi `ENABLE_SCHEDULERS` (test gọi
 * ReconciliationService.reconcile trực tiếp, worker tắt → không nhặt job tồn dư).
 */
@Processor(QUEUE_PAYMENT_RECONCILE, { autorun: false })
export class PaymentReconcileProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(PaymentReconcileProcessor.name);

  constructor(
    private readonly reconciliation: ReconciliationService,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    if (!this.env.ENABLE_SCHEDULERS) {
      this.logger.log('ENABLE_SCHEDULERS=false → worker payment-reconcile không chạy');
      return;
    }
    void this.worker.run().catch((err: unknown) => {
      this.logger.error({ err }, 'Worker payment-reconcile dừng bất thường');
    });
    this.logger.log(`Worker payment-reconcile đang chạy (queue ${QUEUE_PAYMENT_RECONCILE})`);
  }

  async process(job: Job<ReconcileJob>): Promise<{ matched: boolean }> {
    const result = await this.reconciliation.reconcile(job.data.provider, job.data.payload);
    this.logger.log(
      `Đối soát ${job.data.provider}/${job.data.payload.event_id}: ${result.matched ? 'khớp tự động' : 'unmatched'}`,
    );
    return result;
  }
}
