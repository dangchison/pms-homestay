import { Injectable } from '@nestjs/common';
import { MailService } from '@core/mail/mail.service';
import {
  type NotificationChannelProvider,
  type OutboundSendInput,
  type OutboundSendResult,
} from './notification-channel-provider';

/**
 * ★ SmtpEmailProvider (Đợt 4 / M1, docs/18) — kênh EMAIL bọc MailService.send hiện
 * có (dev: Mailpit :1025; prod: relay SMTP). EMAIL luôn dùng provider này bất kể env.
 * MailService best-effort (không ném) → map boolean→status: true='SENT', false='FAILED'.
 * providerMessageId=null (SMTP không trả id ổn định qua nodemailer generic transport).
 */
@Injectable()
export class SmtpEmailProvider implements NotificationChannelProvider {
  readonly name = 'smtp';

  constructor(private readonly mail: MailService) {}

  async send(msg: OutboundSendInput): Promise<OutboundSendResult> {
    const ok = await this.mail.send({
      to: msg.recipient,
      subject: msg.title,
      text: msg.body,
      ...(msg.html ? { html: msg.html } : {}),
    });
    return ok
      ? { status: 'SENT', providerMessageId: null }
      : { status: 'FAILED', providerMessageId: null, errorReason: 'Gửi email thất bại (SMTP)' };
  }
}
