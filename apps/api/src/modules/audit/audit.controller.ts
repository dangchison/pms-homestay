import { Controller, Get, Query } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { AuditService } from './audit.service';
import { AuditLogListQueryDto } from './dto';

/**
 * /api/v1/audit-logs — đọc vết kiểm toán (task 4.5, docs/03 §audit_logs). Toàn
 * tenant (không property-scope): quyền `audit_log.read` (OWNER + ACCOUNTANT) đủ
 * ở pha-1. Append-only — không có endpoint ghi/sửa/xoá (ghi qua AuditInterceptor
 * + service tự động).
 */
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit_log.read')
  async list(@Query() query: AuditLogListQueryDto, @CurrentUser() user: JwtClaims) {
    const { data, page_info } = await this.audit.query(user, query);
    return { data, page_info };
  }
}
