import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '@core/config/env.schema';
import { bullmqConnectionFromUrl } from './redis-connection';

/**
 * Hạ tầng BullMQ dùng chung (docs/01 §queue, docs/13 core/bullmq). Đăng ký
 * connection gốc một lần; module nghiệp vụ gọi `BullModule.registerQueue()` để
 * khai báo queue + `@Processor` của mình (HOLD expiry, sau này night-audit,
 * notifications, sync…).
 *
 * Connection riêng cho BullMQ (KHÔNG tái dùng `REDIS` của RedisModule): worker
 * dùng blocking command cần `maxRetriesPerRequest: null`, còn connection lệnh
 * thường của app đặt `maxRetriesPerRequest: 3` — hai yêu cầu xung khắc.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        connection: bullmqConnectionFromUrl(env.REDIS_URL),
      }),
    }),
  ],
  exports: [BullModule],
})
export class BullmqModule {}
