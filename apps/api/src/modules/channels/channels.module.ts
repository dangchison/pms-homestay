import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_ICAL_PULL } from '@core/bullmq/queues';
import { BookingsModule } from '@modules/bookings/bookings.module';
import { ChannelMappingsController } from './channel-mappings.controller';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { IcalPublicController } from './ical-public.controller';
import { IcalPullProcessor } from './ical-pull.cron';
import { IcalPushService } from './ical-push.service';
import { IcalSyncService } from './ical-sync.service';

/**
 * Channels + resource mappings (5.1) + iCal pull worker (5.2) + iCal push endpoint
 * (5.3). PermissionService (AuthCoreModule @Global) + EncryptionService (CryptoModule
 * @Global) + OutboxService (OutboxModule @Global) + REDIS (RedisModule @Global) inject
 * sẵn. BookingsModule: createFromIcalTx/cancelFromIcalTx (đường ghi booking OTA — cùng
 * choke-point occupancy). Queue `ical-pull`: cron 15'. IcalPublicController = endpoint
 * công khai push iCal (token bí mật, không JWT/tenant).
 */
@Module({
  imports: [BookingsModule, BullModule.registerQueue({ name: QUEUE_ICAL_PULL })],
  controllers: [ChannelsController, ChannelMappingsController, IcalPublicController],
  providers: [ChannelsService, IcalSyncService, IcalPullProcessor, IcalPushService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
