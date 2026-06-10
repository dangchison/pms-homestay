import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, type Env } from '../config/env.schema';

/** Connection chính (commands). */
export const REDIS = Symbol('REDIS');

/**
 * Factory tạo connection RIÊNG cho subscriber — Redis connection ở chế độ
 * subscribe không chạy được command thường (docs/10 §4: 1 subscriber/instance).
 */
export const REDIS_SUBSCRIBER_FACTORY = Symbol('REDIS_SUBSCRIBER_FACTORY');
export type RedisSubscriberFactory = () => Redis;

/** Đóng connection khi app shutdown — tránh treo process/test. */
@Injectable()
class RedisLifecycle implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

@Global()
@Module({
  providers: [
    RedisLifecycle,
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) =>
        new Redis(env.REDIS_URL, {
          maxRetriesPerRequest: 3,
          lazyConnect: false,
        }),
    },
    {
      provide: REDIS_SUBSCRIBER_FACTORY,
      inject: [ENV],
      useFactory:
        (env: Env): RedisSubscriberFactory =>
        () =>
          new Redis(env.REDIS_URL),
    },
  ],
  exports: [REDIS, REDIS_SUBSCRIBER_FACTORY],
})
export class RedisModule {}
