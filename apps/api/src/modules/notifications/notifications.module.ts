import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { QUEUE_NOTIFICATIONS } from '@core/bullmq/queues';
import { NOTIFICATION_SINK } from '@core/outbox/notification-sink';
import { NotificationProcessor } from './notification.processor';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Notifications (task 4.4, docs/10 §7). @Global: provide NOTIFICATION_SINK để
 * OutboxDispatcher (core/outbox) inject @Optional mà không tạo phụ thuộc ngược.
 * Queue `notifications` + worker (gated) + REST inbox in-app. MailService/Prisma @Global sẵn.
 */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NOTIFICATIONS })],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationProcessor,
    { provide: NOTIFICATION_SINK, useExisting: NotificationsService },
  ],
  exports: [NotificationsService, NOTIFICATION_SINK],
})
export class NotificationsModule {}
