import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type Job, Queue } from 'bullmq';
import { QUEUE_NIGHT_AUDIT } from '@core/bullmq/queues';
import { ENV, type Env } from '@core/config/env.schema';
import { SubscriptionService } from '@modules/subscription/subscription.service';
import { NightAuditService } from './night-audit.service';

const SCHEDULER_ID = 'night-audit-daily';
const DAILY_AT_2AM = '0 2 * * *'; // 02:00 hằng ngày (MVP: 1 tick UTC; per-property TZ → mở rộng sau)

/**
 * ★ Cron night-audit (task 4.6) — chạy 02:00 mỗi ngày, quét mọi tenant ACTIVE/
 * TRIAL (NightAuditService.runAllTenants). `autorun:false` + chỉ chạy khi
 * `ENABLE_SCHEDULERS` (test/CI tắt → worker im, gọi runForTenant trực tiếp).
 * `upsertJobScheduler` idempotent theo id; job scheduler BullMQ khoá lịch (1
 * instance/tick) — an toàn multi-instance.
 */
@Processor(QUEUE_NIGHT_AUDIT, { autorun: false })
export class NightAuditProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(NightAuditProcessor.name);

  constructor(
    private readonly nightAudit: NightAuditService,
    private readonly subscription: SubscriptionService,
    @InjectQueue(QUEUE_NIGHT_AUDIT) private readonly queue: Queue,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.ENABLE_SCHEDULERS) {
      this.logger.log('ENABLE_SCHEDULERS=false → bỏ qua night-audit cron');
      return;
    }
    await this.queue.upsertJobScheduler(SCHEDULER_ID, { pattern: DAILY_AT_2AM });
    void this.worker.run().catch((err: unknown) => {
      this.logger.error({ err }, 'Night-audit worker dừng bất thường');
    });
    this.logger.log(`Night-audit cron đã lên lịch 02:00 hằng ngày (queue ${QUEUE_NIGHT_AUDIT})`);
  }

  async process(_job: Job): Promise<{ tenants: number }> {
    const now = new Date();
    // Lifecycle thuê bao trước (4.7): TRIAL/ACTIVE hết hạn → SUSPENDED; SUSPENDED 60d → CHURNED.
    const lifecycle = await this.subscription.runLifecycleSweep(now);
    const tenants = await this.nightAudit.runAllTenants(now);
    this.logger.log(
      `Night-audit xong cho ${tenants} tenant (lifecycle: suspended=${lifecycle.suspended} churned=${lifecycle.churned})`,
    );
    return { tenants };
  }
}
