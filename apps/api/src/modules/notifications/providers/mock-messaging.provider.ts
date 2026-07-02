import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type NotificationChannelProvider,
  type OutboundSendInput,
  type OutboundSendResult,
} from './notification-channel-provider';

/**
 * ★ MockMessagingProvider (Đợt 4 / M1, docs/18) — sandbox SMS/ZNS: "gửi" thành công
 * KHÔNG I/O ngoài, sinh providerMessageId dạng mock-<uuid> để dev/CI chạy end-to-end
 * mọi tích hợp mà không cần credentials thật. Dùng khi SMS_PROVIDER/ZNS_PROVIDER='mock'.
 */
@Injectable()
export class MockMessagingProvider implements NotificationChannelProvider {
  readonly name = 'mock';

  send(_msg: OutboundSendInput): Promise<OutboundSendResult> {
    return Promise.resolve({ status: 'SENT', providerMessageId: `mock-${randomUUID()}` });
  }
}
