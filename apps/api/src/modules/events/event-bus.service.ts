import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { type RealtimeEvent } from '@pms/shared-types';
import type Redis from 'ioredis';
import { type Observable, Subject } from 'rxjs';
import { REDIS_SUBSCRIBER_FACTORY, type RedisSubscriberFactory } from '@core/redis/redis.module';

const CHANNEL_PATTERN = 'tnt:*:events';

/**
 * Một subscriber Redis DUY NHẤT mỗi instance (docs/10 §4) — ioredis ở chế độ
 * subscribe chiếm trọn connection nên KHÔNG mở 1 subscription/SSE client (không
 * scale). psubscribe `tnt:*:events` rồi fan-out IN-PROCESS vào Subject theo tenant;
 * controller pipe(filter quyền) tiếp. SSE client nối instance nào cũng nhận đủ
 * (scale ngang docs/10 §6).
 *
 * LAZY: chỉ mở subscriber khi có SSE client ĐẦU TIÊN (forTenant) — instance không
 * phục vụ stream nào (vd cron-only, hay phần lớn e2e) KHÔNG giữ connection thừa.
 */
@Injectable()
export class EventBusService implements OnModuleDestroy {
  private readonly logger = new Logger(EventBusService.name);
  private sub?: Redis;
  private subscribePromise?: Promise<void>;
  private readonly streams = new Map<string, Subject<RealtimeEvent>>();

  constructor(
    @Inject(REDIS_SUBSCRIBER_FACTORY) private readonly subscriberFactory: RedisSubscriberFactory,
  ) {}

  /** Observable event của một tenant (lazy tạo Subject + mở subscriber). Controller pipe(filter quyền). */
  forTenant(tenantId: string): Observable<RealtimeEvent> {
    this.ensureSubscribed();
    let subject = this.streams.get(tenantId);
    if (!subject) {
      subject = new Subject<RealtimeEvent>();
      this.streams.set(tenantId, subject);
    }
    return subject.asObservable();
  }

  /** Chờ subscriber sẵn sàng (test dùng để hết race trước khi publish). No-op nếu chưa cần. */
  async whenSubscribed(): Promise<void> {
    await this.subscribePromise;
  }

  private ensureSubscribed(): void {
    if (this.subscribePromise) return;
    const sub = this.subscriberFactory();
    this.sub = sub;
    sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
      const tenantId = channel.split(':')[1];
      if (!tenantId) return;
      const subject = this.streams.get(tenantId);
      if (!subject) return; // không SSE client nào của tenant này → bỏ (không ai nghe)
      try {
        subject.next(JSON.parse(message) as RealtimeEvent);
      } catch (err) {
        this.logger.warn({ err, channel }, 'Bỏ qua message SSE không parse được');
      }
    });
    this.subscribePromise = sub
      .psubscribe(CHANNEL_PATTERN)
      .then(() => {
        this.logger.log(`EventBus psubscribe ${CHANNEL_PATTERN} (lazy, 1 subscriber/instance)`);
      })
      .catch((err: unknown) => {
        this.logger.error({ err }, 'EventBus psubscribe lỗi');
      });
  }

  async onModuleDestroy(): Promise<void> {
    for (const subject of this.streams.values()) subject.complete();
    this.streams.clear();
    if (this.sub) await this.sub.quit().catch(() => this.sub?.disconnect());
  }
}
