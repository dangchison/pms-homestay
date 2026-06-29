import { describe, expect, it } from 'vitest';
import { type Env } from '@core/config/env.schema';
import { EmailTemplateService } from '@core/mail/email-template.service';

/** Pure unit test (không DB/SMTP) — render email HTML + escaping (B2, docs/18). */
describe('EmailTemplateService (B2 — email HTML templates)', () => {
  const svc = new EmailTemplateService({ APP_WEB_URL: 'https://app.test' } as Env);

  it('render HTML có thương hiệu + tiêu đề/nội dung + nút CTA', () => {
    const html = svc.render({ title: 'Đặt phòng mới', body: 'Có một đặt phòng mới vừa được tạo.' });
    expect(html.toLowerCase()).toContain('<!doctype html'); // là tài liệu HTML
    expect(html).toContain('PMS Homestay'); // header thương hiệu
    expect(html).toContain('Đặt phòng mới'); // tiêu đề
    expect(html).toContain('Có một đặt phòng mới vừa được tạo.'); // nội dung
    expect(html).toContain('https://app.test'); // CTA trỏ về APP_WEB_URL
    expect(html).toContain('Mở PMS Homestay'); // nhãn CTA
  });

  it('escape biến HTML (chống injection khi nhúng dữ liệu người dùng)', () => {
    const html = svc.render({ title: '<script>alert(1)</script>', body: 'A & B <b>x</b>' });
    expect(html).not.toContain('<script>alert(1)</script>'); // KHÔNG nhúng thô
    expect(html).toContain('&lt;script&gt;'); // đã escape <>
    expect(html).toContain('A &amp; B'); // & → &amp;
  });
});
