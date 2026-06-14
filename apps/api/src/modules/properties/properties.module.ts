import { Module } from '@nestjs/common';
import { SubscriptionModule } from '@modules/subscription/subscription.module';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';

/** SubscriptionModule: plan-limit guard khi tạo property (task 4.7). */
@Module({
  imports: [SubscriptionModule],
  controllers: [PropertiesController],
  providers: [PropertiesService],
  exports: [PropertiesService],
})
export class PropertiesModule {}
