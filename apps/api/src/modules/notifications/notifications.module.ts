import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { QUEUE_NOTIFICATIONS } from '@core/bullmq/queues';
import { NOTIFICATION_SINK } from '@core/outbox/notification-sink';
import { NotificationProcessor } from './notification.processor';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { OutboundMessagesService } from './outbound-messages.service';
import { LogMessagingProvider } from './providers/log-messaging.provider';
import { MockMessagingProvider } from './providers/mock-messaging.provider';
import { NotificationProviderRegistry } from './providers/notification-provider.registry';
import { SmtpEmailProvider } from './providers/smtp-email.provider';

/**
 * Notifications (task 4.4, docs/10 §7). @Global: provide NOTIFICATION_SINK để
 * OutboxDispatcher (core/outbox) inject @Optional mà không tạo phụ thuộc ngược.
 * Queue `notifications` + worker (gated) + REST inbox in-app. MailService/Prisma @Global sẵn.
 *
 * M1 (Đợt 4, docs/18): providers[] cấp 3 NotificationChannelProvider (mock/log/smtp)
 * + NotificationProviderRegistry (DI theo env SMS_PROVIDER/ZNS_PROVIDER; EMAIL luôn
 * SMTP) + OutboundMessagesService (ghi/đọc sổ gửi kênh ngoài, RLS per-tenant).
 */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NOTIFICATIONS })],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationProcessor,
    OutboundMessagesService,
    MockMessagingProvider,
    LogMessagingProvider,
    SmtpEmailProvider,
    NotificationProviderRegistry,
    { provide: NOTIFICATION_SINK, useExisting: NotificationsService },
  ],
  exports: [NotificationsService, OutboundMessagesService, NOTIFICATION_SINK],
})
export class NotificationsModule {}
