import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit/audit.module';
import { GuestsModule } from '@modules/guests/guests.module';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { DataRightsController } from './data-rights.controller';
import { DataRightsService } from './data-rights.service';
import { ForeignResidenceController } from './foreign-residence.controller';
import { ForeignResidenceService } from './foreign-residence.service';

/**
 * Tuân thủ pháp lý VN (EPIC 7). PermissionService (AuthCoreModule @Global) +
 * EncryptionService + StorageService (@Global) inject sẵn. AuditModule: ghi READ_PII
 * (export báo cáo công an 7.2 + data-export 7.3) / DELETE (erasure). GuestsModule:
 * data-correction uỷ thác GuestsService.update. DataRightsService export cho night-audit
 * cron (ẩn danh khách không booking ≥5 năm — task 7.3).
 */
@Module({
  imports: [AuditModule, GuestsModule],
  controllers: [ComplianceController, DataRightsController, ForeignResidenceController],
  providers: [ComplianceService, DataRightsService, ForeignResidenceService],
  exports: [DataRightsService],
})
export class ComplianceModule {}
