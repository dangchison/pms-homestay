import { Module } from '@nestjs/common';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

/** Hồ sơ tenant (task 6.7 S1). PrismaService @Global; PermissionsGuard pha-1 đủ. */
@Module({
  controllers: [TenantController],
  providers: [TenantService],
})
export class TenantModule {}
