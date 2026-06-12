import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { type RealtimeEvent } from '@pms/shared-types';
import type Redis from 'ioredis';
import { Client as PgClient } from 'pg';
import { ENV, type Env } from '@core/config/env.schema';
import { REDIS } from '@core/redis/redis.module';
import { mapWithConcurrency } from './concurrency';
import { type ClaimedOutboxEvent, OutboxService } from './outbox.service';

const BATCH = 100;
const DISPATCH_CONCURRENCY = 10;
const POLL_MS = 5_000; // fallback khi mất NOTIFY (docs/10 §3)
const RECLAIM_MS = 30_000;
const RELISTEN_DELAY_MS = 1_000;

/** Kênh Redis fan-out SSE theo tenant — EventBus psubscribe `tnt:*:events`. */
export function tenantEventChannel(tenantId: string): string {
  return `tnt:${tenantId}:events`;
}

/**
 * ★ Outbox dispatcher (task 4.2, docs/10 §3). Claim PENDING (SKIP LOCKED) → fan-out
 * SSE qua Redis pub → PROCESSED; lỗi → retry; reclaim PROCESSING kẹt 60s.
 *
 * Đánh thức 3 đường: (1) LISTEN `outbox_new` (NOTIFY ngay sau INSERT — hết trễ);
 * (2) poll 5s (fallback khi mất NOTIFY/retry); (3) kick lúc bootstrap (nhặt tồn
 * đọng). Gated bởi `ENABLE_SCHEDULERS` — test/CI tắt → không LISTEN/poll, gọi
 * kick()/reclaim() trực tiếp (như sweepExpiredHolds). Chạy ở MỌI instance đều an
 * toàn: claim bằng SQL, không phụ thuộc khoá lịch BullMQ (docs/10 §6).
 */
@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private running = false;
  private stopped = false;
  private listenClient?: PgClient;
  private pollTimer?: ReturnType<typeof setInterval>;
  private reclaimTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly outbox: OutboxService,
    @Inject(REDIS) private readonly redisPub: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.ENABLE_SCHEDULERS) {
      this.logger.log('ENABLE_SCHEDULERS=false → outbox dispatcher không tự chạy (test gọi kick/reclaim trực tiếp)');
      return;
    }
    await this.startListener();
    this.pollTimer = setInterval(() => void this.kick(), POLL_MS);
    this.reclaimTimer = setInterval(() => void this.reclaim(), RECLAIM_MS);
    void this.kick(); // nhặt event tồn đọng lúc khởi động (vd app crash trước dispatch)
    this.logger.log('Outbox dispatcher đã chạy (LISTEN outbox_new + poll 5s + reclaim 30s)');
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reclaimTimer) clearInterval(this.reclaimTimer);
    if (this.listenClient) await this.listenClient.end().catch(() => undefined);
  }

  /**
   * Claim + dispatch một batch. `running` chống chồng lần chạy (NOTIFY + poll đua
   * nhau). Batch đầy → còn tồn đọng → tự kick tiếp (không đợi poll 5s). Trả số
   * event đã dispatch (test dùng).
   */
  async kick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let count = 0;
    try {
      const events = await this.outbox.claimBatch(BATCH);
      count = events.length;
      if (count > 0) {
        await mapWithConcurrency(events, DISPATCH_CONCURRENCY, (event) => this.dispatchOne(event));
      }
    } catch (err) {
      this.logger.error({ err }, 'Outbox kick lỗi');
    } finally {
      this.running = false;
    }
    if (count === BATCH && !this.stopped && this.env.ENABLE_SCHEDULERS) {
      setImmediate(() => void this.kick());
    }
    return count;
  }

  /** Sweep PROCESSING kẹt → PENDING. Trả số dòng reclaim (test dùng). */
  async reclaim(): Promise<number> {
    try {
      const reclaimed = await this.outbox.reclaimStuck();
      if (reclaimed > 0) {
        this.logger.warn(`Reclaim ${reclaimed} outbox event kẹt PROCESSING (worker crash?)`);
      }
      return reclaimed;
    } catch (err) {
      this.logger.error({ err }, 'Outbox reclaim lỗi');
      return 0;
    }
  }

  private async dispatchOne(event: ClaimedOutboxEvent): Promise<void> {
    try {
      const message: RealtimeEvent = {
        event_id: event.id,
        event_type: event.event_type,
        payload: event.payload,
        ts: event.created_at.toISOString(),
      };
      // 1. Fan-out SSE qua Redis pub (kèm event_id → client dedup at-least-once).
      await this.redisPub.publish(tenantEventChannel(event.tenant_id), JSON.stringify(message));
      // 2. TODO task 4.4: enqueue BullMQ queue `notifications` (email/sms/zns) Ở ĐÂY —
      //    dispatcher KHÔNG gửi trực tiếp (docs/10 §7). Task 4.2 chỉ fan-out SSE.
      await this.outbox.markProcessed(event.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err, event_id: event.id }, 'dispatch outbox lỗi → retry');
      await this.outbox.markRetry(event.id, message);
    }
  }

  /**
   * LISTEN trên một pg connection RIÊNG (không qua Prisma/pooler transaction-mode —
   * docs/10 §3). Mất kết nối → thử LISTEN lại sau 1s (NOTIFY mất chỉ trễ tới poll 5s,
   * không mất event vì outbox bền).
   */
  private async startListener(): Promise<void> {
    const client = new PgClient({ connectionString: this.env.DATABASE_URL });
    client.on('notification', () => void this.kick());
    client.on('error', (err) => {
      this.logger.error({ err }, 'LISTEN outbox_new lỗi — thử kết nối lại');
      this.listenClient = undefined;
      this.scheduleReListen();
    });
    await client.connect();
    await client.query('LISTEN outbox_new');
    this.listenClient = client;
  }

  private scheduleReListen(): void {
    if (this.stopped) return;
    setTimeout(() => {
      if (this.stopped) return;
      this.startListener().catch((err) => this.logger.error({ err }, 'Re-LISTEN outbox_new thất bại'));
    }, RELISTEN_DELAY_MS);
  }
}
