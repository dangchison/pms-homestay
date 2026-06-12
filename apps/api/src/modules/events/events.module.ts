import { Module } from '@nestjs/common';
import { EventBusService } from './event-bus.service';
import { EventsController } from './events.controller';

/**
 * Realtime SSE (task 4.2, docs/10 §4). EventBus subscribe Redis (1/instance) →
 * controller /events/stream fan-out theo tenant + lọc permission. TokenService
 * (AuthCoreModule) + REDIS_SUBSCRIBER_FACTORY (RedisModule) đều @Global.
 */
@Module({
  controllers: [EventsController],
  providers: [EventBusService],
  exports: [EventBusService],
})
export class EventsModule {}
