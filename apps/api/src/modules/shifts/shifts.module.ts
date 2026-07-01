import { Module } from '@nestjs/common';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

/**
 * Sổ quỹ ca + bàn giao ca (task 9.4, docs/16 #10). PermissionService + OutboxService +
 * PrismaService inject toàn cục (@Global). Chỉ ĐỌC payments (JOIN qua Prisma) để tính
 * tiền mặt kỳ vọng — không cần import PaymentsModule.
 */
@Module({
  controllers: [ShiftsController],
  providers: [ShiftsService],
})
export class ShiftsModule {}
