import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type Job, Queue } from 'bullmq';
import { QUEUE_ICAL_PULL } from '@core/bullmq/queues';
import { ENV, type Env } from '@core/config/env.schema';
import { IcalSyncService } from './ical-sync.service';

const SCHEDULER_ID = 'ical-pull-15min';
const EVERY_15_MIN = '*/15 * * * *'; // docs/08 §3 (MVP: 1 tick chung quét mọi mapping active)

/**
 * ★ Cron iCal pull (task 5.2) — mỗi 15' quét mọi mapping active của tenant
 * ACTIVE/TRIAL (IcalSyncService.syncAllActiveMappings). `autorun:false` + chỉ
 * chạy khi `ENABLE_SCHEDULERS` (test/CI tắt → gọi syncMapping trực tiếp với rawFeed).
 */
@Processor(QUEUE_ICAL_PULL, { autorun: false })
export class IcalPullProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(IcalPullProcessor.name);

  constructor(
    private readonly icalSync: IcalSyncService,
    @InjectQueue(QUEUE_ICAL_PULL) private readonly queue: Queue,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.ENABLE_SCHEDULERS) {
      this.logger.log('ENABLE_SCHEDULERS=false → bỏ qua iCal pull cron');
      return;
    }
    await this.queue.upsertJobScheduler(SCHEDULER_ID, { pattern: EVERY_15_MIN });
    void this.worker.run().catch((err: unknown) => {
      this.logger.error({ err }, 'iCal pull worker dừng bất thường');
    });
    this.logger.log(`iCal pull cron đã lên lịch mỗi 15' (queue ${QUEUE_ICAL_PULL})`);
  }

  async process(_job: Job): Promise<{ mappings: number }> {
    const mappings = await this.icalSync.syncAllActiveMappings();
    this.logger.log(`iCal pull xong cho ${mappings} mapping`);
    return { mappings };
  }
}
