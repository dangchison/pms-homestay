import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type Job } from 'bullmq';
import { QUEUE_BILLING_GATEWAY } from '@core/bullmq/queues';
import { ENV, type Env } from '@core/config/env.schema';
import { type MockGatewayJobData, SubscriptionService } from './subscription.service';

/**
 * Worker cổng thanh toán mock/sandbox (Đợt 4/M2, docs/18 B4) — tiêu thụ delayed
 * job trong queue `billing-gateway`, tự xác nhận payment thuê bao sau độ trễ mô
 * phỏng (MOCK_GATEWAY_AUTOCONFIRM_SECONDS). Tái dùng đường ghi `confirmPayment`
 * (tenant → ACTIVE + gia hạn) qua resolver ref không cần — job mang thẳng paymentId.
 *
 * `autorun:false` + chỉ chạy khi ENABLE_SCHEDULERS: test/CI tắt worker → không nhặt
 * job tồn dư; e2e gọi `process(job)` trực tiếp (như PaymentReconcileProcessor).
 * Processor luôn được đăng ký (kể cả mode manual) để DI ổn định; nhưng ở mode
 * manual KHÔNG có job nào được enqueue nên worker rảnh — an toàn.
 */
@Processor(QUEUE_BILLING_GATEWAY, { autorun: false })
export class BillingGatewayProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(BillingGatewayProcessor.name);

  constructor(
    private readonly subscription: SubscriptionService,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    if (!this.env.ENABLE_SCHEDULERS) {
      this.logger.log('ENABLE_SCHEDULERS=false → worker billing-gateway không chạy');
      return;
    }
    void this.worker.run().catch((err: unknown) => {
      this.logger.error({ err }, 'Worker billing-gateway dừng bất thường');
    });
    this.logger.log(`Worker billing-gateway đang chạy (queue ${QUEUE_BILLING_GATEWAY})`);
  }

  async process(job: Job<MockGatewayJobData>): Promise<{ paymentId: string; status: string }> {
    const result = await this.subscription.confirmPayment(job.data.paymentId);
    this.logger.log(`Mock-gateway auto-confirm: payment=${job.data.paymentId} → ${result.status}`);
    return { paymentId: job.data.paymentId, status: result.status };
  }
}
