import { Global, Module } from '@nestjs/common';
import { EmailTemplateService } from './email-template.service';
import { MailService } from './mail.service';

/**
 * Mail dùng chung (@Global) — notifications (4.4) + auth inject MailService.
 * EmailTemplateService (B2): render email HTML có thương hiệu (Handlebars).
 */
@Global()
@Module({
  providers: [MailService, EmailTemplateService],
  exports: [MailService, EmailTemplateService],
})
export class MailModule {}
