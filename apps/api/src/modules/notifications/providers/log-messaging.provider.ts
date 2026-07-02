import { Injectable, Logger } from '@nestjs/common';
import {
  type NotificationChannelProvider,
  type OutboundSendInput,
  type OutboundSendResult,
} from './notification-channel-provider';

/**
 * ★ LogMessagingProvider (Đợt 4 / M1, docs/18) — backward-compatible mode 'log':
 * TÁI HIỆN hành vi stub cũ của NotificationsService (chỉ logger.log '[stub <channel>]',
 * KHÔNG I/O ngoài, KHÔNG throw). Dùng khi SMS_PROVIDER/ZNS_PROVIDER='log' — vận hành
 * viên chọn mode log khi chưa có creds. Khác biệt DUY NHẤT so với trước: nay dòng gửi
 * cũng được ghi vào outbound_messages (provider='log', status='SENT', id=NULL).
 */
@Injectable()
export class LogMessagingProvider implements NotificationChannelProvider {
  readonly name = 'log';
  private readonly logger = new Logger(LogMessagingProvider.name);

  send(msg: OutboundSendInput): Promise<OutboundSendResult> {
    this.logger.log(`[stub ${msg.channel}] to=${msg.recipient} "${msg.title}" — provider chưa cấu hình`);
    return Promise.resolve({ status: 'SENT', providerMessageId: null });
  }
}
