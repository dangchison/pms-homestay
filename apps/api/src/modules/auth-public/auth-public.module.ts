import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit/audit.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MailerService } from './mailer.service';
import { ThrottleService } from './throttle.service';
import { TwoFactorService } from './two-factor.service';

/** AuditModule: AuthService ghi vết LOGIN/LOGOUT tường minh (B3, docs/18). */
@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [AuthService, ThrottleService, TwoFactorService, MailerService],
  exports: [AuthService], // task 6.7: UsersModule tái dùng forgotPassword cho email mời
})
export class AuthPublicModule {}
