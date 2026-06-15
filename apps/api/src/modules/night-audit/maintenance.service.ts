import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@core/prisma/prisma.service';

export interface AuditPartitionMaintenanceResult {
  /** Số partition tháng mới vừa tạo. */
  created: number;
  /** Tên các partition cũ vừa detach + đổi tên archive. */
  archived: string[];
  /** Tháng (YYYY_MM) trong cửa sổ tới còn THIẾU partition (rỗng = khoẻ). */
  missing: string[];
}

/**
 * Bảo trì vòng đời dữ liệu (task 8.5). Gọi các SQL function SECURITY DEFINER (0026)
 * — chạy NGOÀI ngữ cảnh tenant (cross-tenant, DDL với quyền owner). Night-audit
 * gọi hằng ngày: tạo partition audit_logs tháng kế, archive partition quá hạn lưu,
 * cảnh báo nếu partition sắp tới chưa tồn tại (alert docs/11 §9).
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async runAuditPartitionMaintenance(opts?: {
    monthsAhead?: number;
    keepMonths?: number;
  }): Promise<AuditPartitionMaintenanceResult> {
    const monthsAhead = opts?.monthsAhead ?? 3;
    const keepMonths = opts?.keepMonths ?? 12;

    const createdRows = await this.prisma.$queryRaw<{ created: number }[]>`
      SELECT ensure_audit_partitions(${monthsAhead}::int) AS created`;
    const archivedRows = await this.prisma.$queryRaw<{ archived: string[] }[]>`
      SELECT detach_old_audit_partitions(${keepMonths}::int) AS archived`;
    const missingRows = await this.prisma.$queryRaw<{ missing: string[] }[]>`
      SELECT audit_partitions_missing(1::int) AS missing`;

    const result: AuditPartitionMaintenanceResult = {
      created: Number(createdRows[0]?.created ?? 0),
      archived: archivedRows[0]?.archived ?? [],
      missing: missingRows[0]?.missing ?? [],
    };

    if (result.missing.length > 0) {
      // Lưới an toàn (default partition) vẫn nhận INSERT, nhưng đây là tín hiệu lỗi
      // lịch maintenance → log ERROR để monitoring (8.2) bắn alert.
      this.logger.error(
        `[ALERT] audit_logs thiếu partition tháng tới: ${result.missing.join(', ')} — kiểm tra ensure_audit_partitions`,
      );
    } else if (result.created > 0 || result.archived.length > 0) {
      this.logger.log(
        `Partition audit_logs: +${result.created} mới, archive ${result.archived.length} (${result.archived.join(', ') || 'không'})`,
      );
    }
    return result;
  }
}
