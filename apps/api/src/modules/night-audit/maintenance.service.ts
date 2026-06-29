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

export interface OutboxRetentionResult {
  processed_deleted: number;
  failed_deleted: number;
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

  /**
   * Retention outbox_events (docs/03 §7) — bảng GLOBAL no-RLS (cross-tenant như
   * audit partition): xoá PROCESSED > 7 ngày + FAILED > 90 ngày (sau khi alert đã
   * xử lý). `$executeRaw` (miễn tenancy lint, không cần ngữ cảnh tenant). Night-audit
   * gọi mỗi đêm. Các bảng RLS per-tenant dọn ở NightAuditService.cleanupRetention.
   */
  async runOutboxRetention(): Promise<OutboxRetentionResult> {
    const processed = await this.prisma.$executeRaw`
      DELETE FROM outbox_events WHERE status = 'PROCESSED' AND created_at < now() - interval '7 days'`;
    const failed = await this.prisma.$executeRaw`
      DELETE FROM outbox_events WHERE status = 'FAILED' AND created_at < now() - interval '90 days'`;
    if (processed > 0 || failed > 0) {
      this.logger.log(`Retention outbox_events: PROCESSED=${processed}, FAILED=${failed} đã xoá`);
    }
    return { processed_deleted: processed, failed_deleted: failed };
  }
}
