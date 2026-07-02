import { type OutboundChannel } from '@pms/shared-types';

/**
 * ★ NotificationChannelProvider (Đợt 4 / M1, docs/18) — trừu tượng hoá 1 kênh gửi
 * ngoài (SMS/ZNS/EMAIL). NotificationProviderRegistry chọn implementation theo env
 * (SMS_PROVIDER/ZNS_PROVIDER; EMAIL luôn SMTP). Đợt 4 chạy mock/sandbox — không cần
 * credentials thật. esms/zalo là slot creds Phase sau (chưa impl).
 */

/** Tham số gửi 1 tin qua provider ngoài. */
export interface OutboundSendInput {
  channel: OutboundChannel;
  recipient: string;
  title: string;
  body: string;
  /** HTML tuỳ chọn cho EMAIL (SmtpEmailProvider dùng; SMS/ZNS bỏ qua). */
  html?: string;
}

/** Kết quả gửi — map thẳng vào cột outbound_messages(status, provider_message_id, error_reason). */
export interface OutboundSendResult {
  status: 'SENT' | 'FAILED';
  /** id từ provider (mock-<uuid> cho mock; null cho log/best-effort). */
  providerMessageId: string | null;
  errorReason?: string;
}

export interface NotificationChannelProvider {
  /** Nhãn provider ghi vào outbound_messages.provider (mock|log|zalo|esms|smtp). */
  readonly name: string;
  send(msg: OutboundSendInput): Promise<OutboundSendResult>;
}
