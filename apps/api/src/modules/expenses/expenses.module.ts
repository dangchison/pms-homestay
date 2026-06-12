import { Module } from '@nestjs/common';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

/**
 * Chi phí vận hành + hoa hồng OTA (task 3.6). PermissionService inject toàn cục
 * (AuthCoreModule @Global). Export ExpensesService cho BookingsModule (auto OTA
 * commission khi check-out) + night-audit 4.6 (sinh chi phí định kỳ).
 */
@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
