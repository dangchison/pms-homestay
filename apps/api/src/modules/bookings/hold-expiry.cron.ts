import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type Job, Queue } from 'bullmq';
import { QUEUE_HOLD_EXPIRY } from '@core/bullmq/queues';
import { ENV, type Env } from '@core/config/env.schema';
import { BookingsService } from './bookings.service';

const SCHEDULER_ID = 'hold-expiry-every-minute';
const EVERY_MINUTE = '* * * * *';

/**
 * ★ Cron HOLD expiry (docs/06 §4, task 2.7) — mỗi phút quét HOLD quá hạn →
 * CANCELLED(HOLD_EXPIRED) + xoá occupancy (logic ở BookingsService.sweepExpiredHolds).
 *
 * `autorun: false`: worker được TẠO nhưng KHÔNG poll cho tới khi gọi `worker.run()`.
 * Khi `ENABLE_SCHEDULERS=false` (test/CI) ta không lên lịch và không gọi run →
 * worker im, không nhặt job scheduler tồn dư trong Redis từ lần chạy dev trước.
 *
 * `upsertJobScheduler` idempotent theo id → boot lại không nhân đôi lịch. Job
 * scheduler của BullMQ chỉ khoá LỊCH chạy (1 instance chạy 1 tick) — không khoá
 * dữ liệu; an toàn khi chạy nhiều instance (docs/10 §3).
 */
@Processor(QUEUE_HOLD_EXPIRY, { autorun: false })
export class HoldExpiryProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(HoldExpiryProcessor.name);

  constructor(
    private readonly bookings: BookingsService,
    @InjectQueue(QUEUE_HOLD_EXPIRY) private readonly queue: Queue,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.ENABLE_SCHEDULERS) {
      this.logger.log('ENABLE_SCHEDULERS=false → bỏ qua HOLD expiry cron');
      return;
    }
    await this.queue.upsertJobScheduler(SCHEDULER_ID, { pattern: EVERY_MINUTE });
    void this.worker.run().catch((err: unknown) => {
      this.logger.error({ err }, 'HOLD expiry worker dừng bất thường');
    });
    this.logger.log(`HOLD expiry cron đã lên lịch mỗi phút (queue ${QUEUE_HOLD_EXPIRY})`);
  }

  async process(_job: Job): Promise<{ cancelled: number }> {
    const cancelled = await this.bookings.sweepExpiredHolds();
    if (cancelled > 0) this.logger.log(`HOLD expiry: huỷ ${cancelled} booking quá hạn`);
    return { cancelled };
  }
}
