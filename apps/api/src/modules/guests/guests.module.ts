import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit/audit.module';
import { GuestsController } from './guests.controller';
import { GuestsService } from './guests.service';
import { OcrService } from './ocr.service';

/**
 * EncryptionService + StorageService inject từ module @Global. Export cho booking
 * (2.6). AuditModule: ghi action READ_PII khi giải mã số giấy tờ (task 4.5).
 * OcrService: scan CCCD qua FPT.AI (task 7.1) — gọi external ngoài tx.
 */
@Module({
  imports: [AuditModule],
  controllers: [GuestsController],
  providers: [GuestsService, OcrService],
  exports: [GuestsService],
})
export class GuestsModule {}
