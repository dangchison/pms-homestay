import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { createTransport, type Transporter } from 'nodemailer';
import { ENV, type Env } from '@core/config/env.schema';

/**
 * Mail dùng chung (dev: Mailpit :1025, UI :8025; prod: Resend SMTP/relay qua cùng
 * env SMTP_*). Generic `send()` cho notifications (task 4.4) + có thể thay auth's
 * MailerService sau. Best-effort: lỗi SMTP → log, KHÔNG ném (notification in-app
 * vẫn là kênh tin cậy; email phụ trợ).
 */
@Injectable()
export class MailService {
  private readonly transporter: Transporter;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly logger: Logger,
  ) {
    this.transporter = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false,
    });
  }

  /** Trả true nếu gửi thành công. KHÔNG ném (best-effort). */
  async send(opts: { to: string; subject: string; text: string }): Promise<boolean> {
    try {
      await this.transporter.sendMail({
        from: 'PMS Homestay <no-reply@pmsapp.vn>',
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
      });
      return true;
    } catch (err) {
      this.logger.error({ err, to: opts.to }, 'Gửi email thất bại (best-effort)');
      return false;
    }
  }
}
