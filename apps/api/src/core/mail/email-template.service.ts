import { Inject, Injectable } from '@nestjs/common';
import Handlebars from 'handlebars';
import { ENV, type Env } from '@core/config/env.schema';

/**
 * Layout email responsive (table + inline CSS — an toàn mọi email client; tương
 * đương output MJML). Biến `{{title}}`/`{{body}}` Handlebars TỰ escape HTML nên an
 * toàn khi nhúng dữ liệu người dùng (tên khách, cơ sở…). `ctaUrl` từ config (tin cậy).
 */
const LAYOUT_HBS = `<!doctype html>
<html lang="vi">
  <body style="margin:0;padding:0;background-color:#f4f5f7;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:8px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
            <tr>
              <td style="background-color:#0f766e;padding:20px 24px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;">PMS Homestay</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <h1 style="margin:0 0 12px;font-size:18px;color:#111827;">{{title}}</h1>
                <p style="margin:0;font-size:14px;line-height:22px;color:#374151;">{{body}}</p>
                {{#if ctaUrl}}
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0;">
                  <tr>
                    <td style="border-radius:6px;background-color:#0f766e;">
                      <a href="{{ctaUrl}}" style="display:inline-block;padding:10px 20px;font-size:14px;color:#ffffff;text-decoration:none;font-weight:600;">Mở PMS Homestay</a>
                    </td>
                  </tr>
                </table>
                {{/if}}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;border-top:1px solid #e5e7eb;">
                <p style="margin:0;font-size:12px;color:#9ca3af;">Email tự động từ PMS Homestay — vui lòng không trả lời email này.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

export interface EmailContent {
  title: string;
  body: string;
}

/**
 * Render email HTML có thương hiệu từ template Handlebars (B2, docs/18). Compile
 * layout 1 lần lúc khởi tạo; mỗi lần gửi chỉ interpolate (nhanh). Template phức tạp
 * hơn / nguồn MJML có thể thêm sau (precompile) — runtime giữ Handlebars.
 */
@Injectable()
export class EmailTemplateService {
  private readonly layout: Handlebars.TemplateDelegate;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.layout = Handlebars.compile(LAYOUT_HBS);
  }

  render(content: EmailContent): string {
    return this.layout({ title: content.title, body: content.body, ctaUrl: this.env.APP_WEB_URL });
  }
}
