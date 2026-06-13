import { Module } from '@nestjs/common';
import { CleaningController } from './cleaning.controller';
import { CleaningService } from './cleaning.service';

/**
 * Việc dọn phòng (task 4.1). PermissionService (AuthCoreModule @Global), OutboxService
 * (OutboxModule @Global), StorageService (StorageModule @Global) inject sẵn. Export
 * CleaningService cho BookingsModule gọi createCheckoutTasksTx khi CHECKED_OUT/switch.
 */
@Module({
  controllers: [CleaningController],
  providers: [CleaningService],
  exports: [CleaningService],
})
export class CleaningModule {}
