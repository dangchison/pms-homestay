import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit/audit.module';
import { GuestsController } from './guests.controller';
import { GuestsService } from './guests.service';

/**
 * EncryptionService inject từ CryptoModule (@Global). Export cho booking (2.6).
 * AuditModule: ghi action READ_PII khi giải mã số giấy tờ (task 4.5).
 */
@Module({
  imports: [AuditModule],
  controllers: [GuestsController],
  providers: [GuestsService],
  exports: [GuestsService],
})
export class GuestsModule {}
