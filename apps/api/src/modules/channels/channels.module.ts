import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_ICAL_PULL } from '@core/bullmq/queues';
import { BookingsModule } from '@modules/bookings/bookings.module';
import { ChannelMappingsController } from './channel-mappings.controller';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { IcalPullProcessor } from './ical-pull.cron';
import { IcalSyncService } from './ical-sync.service';

/**
 * Channels + resource mappings (5.1) + iCal pull worker (5.2). PermissionService
 * (AuthCoreModule @Global) + EncryptionService (CryptoModule @Global) + OutboxService
 * (OutboxModule @Global) inject sẵn. BookingsModule: createFromIcalTx/cancelFromIcalTx
 * (đường ghi booking OTA — cùng choke-point occupancy). Queue `ical-pull`: cron 15'.
 */
@Module({
  imports: [BookingsModule, BullModule.registerQueue({ name: QUEUE_ICAL_PULL })],
  controllers: [ChannelsController, ChannelMappingsController],
  providers: [ChannelsService, IcalSyncService, IcalPullProcessor],
  exports: [ChannelsService],
})
export class ChannelsModule {}
