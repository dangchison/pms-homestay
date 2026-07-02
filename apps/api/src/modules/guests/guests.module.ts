import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit/audit.module';
import { ENV, type Env } from '@core/config/env.schema';
import { GuestsController } from './guests.controller';
import { GuestsService } from './guests.service';
import { FptOcrProvider } from './providers/fpt-ocr.provider';
import { MockOcrProvider } from './providers/mock-ocr.provider';
import { OCR_PROVIDER_TOKEN, type OcrProvider } from './providers/ocr-provider';

/**
 * EncryptionService + StorageService inject từ module @Global. Export cho booking
 * (2.6). AuditModule: ghi action READ_PII khi giải mã số giấy tờ (task 4.5).
 *
 * M3 (Đợt 4, docs/18): OCR CCCD tách thành OcrProvider. providers[] cấp FptOcrProvider
 * (name='fpt', FPT.AI thật — task 7.1) + MockOcrProvider (name='mock', sandbox tất định
 * KHÔNG cần creds) + factory OCR_PROVIDER_TOKEN chọn theo env.OCR_PROVIDER:
 *   - auto (mặc định) | fpt → FptOcrProvider (có FPT_AI_API_KEY→gọi FPT; else 503).
 *   - mock              → MockOcrProvider (chỉ khi set tường minh — KHÔNG tự bật ở prod).
 * Factory inject INSTANCE đã tạo (KHÔNG new mỗi request) → FptOcrProvider singleton giữ
 * 1 circuit breaker duy nhất. GuestsService inject qua token (không phụ thuộc class cụ thể).
 */
@Module({
  imports: [AuditModule],
  controllers: [GuestsController],
  providers: [
    GuestsService,
    FptOcrProvider,
    MockOcrProvider,
    {
      provide: OCR_PROVIDER_TOKEN,
      useFactory: (env: Env, fpt: FptOcrProvider, mock: MockOcrProvider): OcrProvider =>
        env.OCR_PROVIDER === 'mock' ? mock : fpt,
      inject: [ENV, FptOcrProvider, MockOcrProvider],
    },
  ],
  exports: [GuestsService],
})
export class GuestsModule {}
