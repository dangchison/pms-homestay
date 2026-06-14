import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit/audit.module';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';

/**
 * Tuân thủ pháp lý VN (EPIC 7). PermissionService (AuthCoreModule @Global) +
 * EncryptionService (CryptoModule @Global) inject sẵn. AuditModule: ghi READ_PII
 * khi export báo cáo công an (giải mã số giấy tờ — task 7.2).
 */
@Module({
  imports: [AuditModule],
  controllers: [ComplianceController],
  providers: [ComplianceService],
})
export class ComplianceModule {}
