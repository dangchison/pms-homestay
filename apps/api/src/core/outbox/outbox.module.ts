import { Global, Module } from '@nestjs/common';
import { OutboxDispatcher } from './outbox.dispatcher';
import { OutboxService } from './outbox.service';

/**
 * Transactional Outbox v2 (task 4.2, docs/10 §3). @Global: module nghiệp vụ
 * (task 4.3) inject `OutboxService.publish(tx, ...)` trong tx của mình mà KHÔNG
 * cần import. Dispatcher tự chạy LISTEN/poll khi ENABLE_SCHEDULERS. PrismaService,
 * REDIS, ENV đều @Global sẵn.
 */
@Global()
@Module({
  providers: [OutboxService, OutboxDispatcher],
  exports: [OutboxService, OutboxDispatcher],
})
export class OutboxModule {}
