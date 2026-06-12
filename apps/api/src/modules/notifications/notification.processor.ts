import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type Job } from 'bullmq';
import { QUEUE_NOTIFICATIONS } from '@core/bullmq/queues';
import { ENV, type Env } from '@core/config/env.schema';
import { type NotificationEventInput } from './notification-targets';
import { NotificationsService } from './notifications.service';

/**
 * ★ Worker queue `notifications` (task 4.4, docs/10 §7) — event-driven (KHÔNG cron):
 * dispatcher enqueue job/event → worker route + deliver. `autorun:false` + chỉ
 * `worker.run()` khi `ENABLE_SCHEDULERS` (test/CI tắt → gọi processEvent trực tiếp).
 * BullMQ retry exponential backoff cho job lỗi (email tạm down…).
 */
@Processor(QUEUE_NOTIFICATIONS, { autorun: false })
export class NotificationProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    if (!this.env.ENABLE_SCHEDULERS) {
      this.logger.log('ENABLE_SCHEDULERS=false → notification worker không chạy');
      return;
    }
    void this.worker.run().catch((err: unknown) => {
      this.logger.error({ err }, 'Notification worker dừng bất thường');
    });
    this.logger.log(`Notification worker đã chạy (queue ${QUEUE_NOTIFICATIONS})`);
  }

  async process(job: Job<NotificationEventInput>): Promise<{ delivered: number }> {
    return this.notifications.processEvent(job.data);
  }
}
