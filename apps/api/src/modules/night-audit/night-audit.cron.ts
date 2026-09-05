import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type Job, Queue } from 'bullmq';
import { QUEUE_NIGHT_AUDIT } from '@core/bullmq/queues';
import { ENV, type Env } from '@core/config/env.schema';
import { DataRightsService } from '@modules/compliance/data-rights.service';
import { SubscriptionService } from '@modules/subscription/subscription.service';
import { MaintenanceService } from './maintenance.service';
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
    private readonly dataRights: DataRightsService,
    private readonly maintenance: MaintenanceService,
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
    // Lifecycle thuê bao trước (4.7): TRIAL hết hạn → hạ về FREE; ACTIVE hết hạn
    // thuê bao → SUSPENDED; SUSPENDED 60d → CHURNED.
    const lifecycle = await this.subscription.runLifecycleSweep(now);
    const tenants = await this.nightAudit.runAllTenants(now);
    // NĐ13 retention (7.3): ẩn danh khách không booking ≥5 năm (cross-tenant, idempotent).
    const anonymized = await this.dataRights.anonymizeStaleGuests(now);
    // Vòng đời partition audit_logs (8.5): tạo tháng kế + archive cũ + alert nếu thiếu.
    const partitions = await this.maintenance.runAuditPartitionMaintenance();
    // Retention outbox_events global (B1, docs/03 §7): PROCESSED >7d + FAILED >90d.
    const outbox = await this.maintenance.runOutboxRetention();
    this.logger.log(
      `Night-audit xong cho ${tenants} tenant (lifecycle: downgraded=${lifecycle.downgraded} suspended=${lifecycle.suspended} churned=${lifecycle.churned}; anonymized=${anonymized}; partitions: +${partitions.created}/archive ${partitions.archived.length}/missing ${partitions.missing.length}; outbox-retention: processed=${outbox.processed_deleted}/failed=${outbox.failed_deleted})`,
    );
    return { tenants };
  }
}
