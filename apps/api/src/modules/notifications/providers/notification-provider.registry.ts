import { Inject, Injectable, Logger } from '@nestjs/common';
import { type OutboundChannel } from '@pms/shared-types';
import { ENV, type Env } from '@core/config/env.schema';
import { AppException } from '@core/http/exceptions/app.exception';
import { LogMessagingProvider } from './log-messaging.provider';
import { MockMessagingProvider } from './mock-messaging.provider';
import { type NotificationChannelProvider } from './notification-channel-provider';
import { SmtpEmailProvider } from './smtp-email.provider';

/**
 * ★ NotificationProviderRegistry (Đợt 4 / M1, docs/18) — DI theo env: chọn provider
 * cho từng kênh gửi ngoài.
 *   - EMAIL  → luôn SmtpEmailProvider (Mailpit/relay), bất kể env.
 *   - SMS    → SMS_PROVIDER: mock→MockMessagingProvider, log→LogMessagingProvider,
 *              esms→CHƯA impl (slot creds Phase sau).
 *   - ZNS    → ZNS_PROVIDER: mock→MockMessagingProvider, log→LogMessagingProvider,
 *              zalo→CHƯA impl (slot creds Phase sau).
 * esms/zalo NÉM AppException 'provider chưa cấu hình' (KHÔNG có creds ở Đợt 4 —
 * mặc định 'mock' để dev/CI chạy end-to-end). Fail rõ ràng thay vì gửi thật.
 */
@Injectable()
export class NotificationProviderRegistry {
  private readonly logger = new Logger(NotificationProviderRegistry.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly mock: MockMessagingProvider,
    private readonly log: LogMessagingProvider,
    private readonly smtp: SmtpEmailProvider,
  ) {}

  forChannel(channel: OutboundChannel): NotificationChannelProvider {
    if (channel === 'EMAIL') return this.smtp;
    const key = channel === 'SMS' ? this.env.SMS_PROVIDER : this.env.ZNS_PROVIDER;
    switch (key) {
      case 'mock':
        return this.mock;
      case 'log':
        return this.log;
      default:
        // esms/zalo — slot creds Phase sau, CHƯA impl. Fail rõ ràng (không gửi thật).
        this.logger.warn(`Provider '${key}' cho kênh ${channel} chưa cấu hình (Phase creds)`);
        throw new AppException({
          code: 'NOTIFICATION_PROVIDER_NOT_CONFIGURED',
          title: 'Provider chưa cấu hình',
          status: 503,
          detail: `Provider '${key}' cho kênh ${channel} chưa được tích hợp (cần credentials — Phase sau).`,
        });
    }
  }
}
