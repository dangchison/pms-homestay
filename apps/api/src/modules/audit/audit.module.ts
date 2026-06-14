import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';

/**
 * Audit log (task 4.5). AuditInterceptor đăng ký APP_INTERCEPTOR (global) → tự
 * ghi mọi mutation HTTP. Export AuditService cho module khác ghi action tường
 * minh (GuestsModule → READ_PII; auth → LOGIN/LOGOUT sau). PrismaService global.
 */
@Module({
  controllers: [AuditController],
  providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
  exports: [AuditService],
})
export class AuditModule {}
