import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/** Mail dùng chung (@Global) — notifications (4.4) + auth inject MailService. */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
