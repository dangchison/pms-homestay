import { Module } from '@nestjs/common';
import { ChannelMappingsController } from './channel-mappings.controller';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';

/**
 * Channels + resource mappings (task 5.1). PermissionService (AuthCoreModule
 * @Global) + EncryptionService (CryptoModule @Global) inject sẵn. Export
 * ChannelsService cho worker pull/push (5.2/5.3) dùng getDecryptedConfig.
 */
@Module({
  controllers: [ChannelsController, ChannelMappingsController],
  providers: [ChannelsService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
