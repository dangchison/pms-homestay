import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';

/**
 * Tài sản cố định + khấu hao (task 3.5). PermissionService inject toàn cục
 * (AuthCoreModule @Global). Export AssetsService cho night-audit (4.6) gọi
 * runMonthlyDepreciation per tenant.
 */
@Module({
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
