import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { createTransport, type Transporter } from 'nodemailer';
import { ENV, type Env } from '@core/config/env.schema';

/**
 * Mailer tối thiểu cho auth (dev: Mailpit :1025, UI :8025).
 * TODO(task 4.4): thay bằng notifications module (email-resend + template +
 * dispatcher queue) — file này chỉ phục vụ flow reset password của 1.7.
 */
@Injectable()
export class MailerService {
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

  /** Best-effort — lỗi SMTP không làm fail flow (tránh user enumeration qua lỗi). */
  async sendPasswordReset(to: string, token: string): Promise<void> {
    const link = `${this.env.APP_WEB_URL}/reset-password?token=${token}`;
    try {
      await this.transporter.sendMail({
        from: 'PMS Homestay <no-reply@pmsapp.vn>',
        to,
        subject: 'Đặt lại mật khẩu — PMS Homestay',
        text: `Bạn (hoặc ai đó) yêu cầu đặt lại mật khẩu.\n\nLink hiệu lực 30 phút:\n${link}\n\nNếu không phải bạn, bỏ qua email này.`,
      });
    } catch (err) {
      this.logger.error({ err }, 'Gửi email reset password thất bại');
    }
  }

  async sendAccountLockedWarning(to: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: 'PMS Homestay <no-reply@pmsapp.vn>',
        to,
        subject: 'Cảnh báo bảo mật — tài khoản tạm khoá 30 phút',
        text: 'Tài khoản của bạn bị khoá 30 phút do đăng nhập sai quá 5 lần trong 15 phút. Nếu không phải bạn, hãy đổi mật khẩu ngay khi đăng nhập lại.',
      });
    } catch (err) {
      this.logger.error({ err }, 'Gửi email cảnh báo khoá tài khoản thất bại');
    }
  }
}
