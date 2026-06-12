import { Injectable, Logger } from '@nestjs/common';
import { type OutboxPublishInput } from '@pms/shared-types';
import { type Prisma } from '@prisma/client';
import { PrismaService } from '@core/prisma/prisma.service';

/** Hàng outbox đã claim — subset cột cần để fan-out (docs/10 §3). */
export interface ClaimedOutboxEvent {
  id: string;
  tenant_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

/** ≥10 lần dispatch lỗi → FAILED + alert (docs/10 §3). */
const MAX_RETRY = 10;
/** PROCESSING quá ngần này = worker crash sau claim → reclaim về PENDING (docs/10 §3). */
const STUCK_AFTER_SECONDS = 60;
/** Retention docs/10 §8 / docs/03 §7. */
const PROCESSED_RETENTION_DAYS = 7;
const FAILED_RETENTION_DAYS = 90;

/**
 * Transactional Outbox v2 (task 4.2, docs/10 §3). Hai mặt:
 * - `publish(tx, ...)`: INSERT event CÙNG tx với entity (gọi trong withTenant).
 * - claim/mark/reclaim/purge: thao tác CROSS-TENANT của dispatcher trên bảng
 *   no-RLS (chạy trên PrismaService gốc, KHÔNG withTenant). Raw SQL vì
 *   `FOR UPDATE SKIP LOCKED` không biểu diễn được qua Prisma ORM.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * ★ Publish trong CÙNG tx với entity (docs/10 §3). Gọi BÊN TRONG withTenant →
   * tenant_id suy ra từ GUC `app.current_tenant_id` (set ở câu lệnh đầu của
   * withTenant) nên luôn khớp tenant của entity vừa ghi. Chỉ INSERT, KHÔNG external
   * I/O → giữ tx ngắn (ADR-0002). Commit là entity + event cùng tồn tại.
   */
  async publish(tx: Prisma.TransactionClient, input: OutboxPublishInput): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO outbox_events (tenant_id, event_type, aggregate_type, aggregate_id, payload)
      VALUES (
        NULLIF(current_setting('app.current_tenant_id', true), '')::uuid,
        ${input.event_type},
        ${input.aggregate_type},
        ${input.aggregate_id}::uuid,
        ${JSON.stringify(input.payload)}::jsonb
      )`;
  }

  /**
   * Claim atomic một batch PENDING (cross-tenant, ORDER BY created_at). `FOR UPDATE
   * SKIP LOCKED` → nhiều instance/lần chạy KHÔNG bao giờ lấy trùng row (docs/10 §6).
   */
  async claimBatch(limit: number): Promise<ClaimedOutboxEvent[]> {
    return this.prisma.$queryRaw<ClaimedOutboxEvent[]>`
      UPDATE outbox_events SET status = 'PROCESSING', claimed_at = now()
      WHERE id IN (
        SELECT id FROM outbox_events
        WHERE status = 'PENDING'
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, tenant_id, event_type, aggregate_type, aggregate_id, payload, created_at`;
  }

  async markProcessed(id: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE outbox_events
      SET status = 'PROCESSED', processed_at = now(), last_error = NULL
      WHERE id = ${id}::uuid`;
  }

  /** Lỗi dispatch → PENDING lại (retry_count++); chạm MAX_RETRY → FAILED + alert. */
  async markRetry(id: string, error: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE outbox_events
      SET status = CASE WHEN retry_count + 1 >= ${MAX_RETRY} THEN 'FAILED' ELSE 'PENDING' END,
          retry_count = retry_count + 1,
          last_error = ${error},
          claimed_at = NULL
      WHERE id = ${id}::uuid`;
  }

  /**
   * Worker crash sau claim → row kẹt PROCESSING vĩnh viễn. Sweep trả về PENDING +
   * retry_count++ (docs/10 §3). Trả số dòng đã reclaim.
   */
  async reclaimStuck(): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE outbox_events
      SET status = 'PENDING', retry_count = retry_count + 1, claimed_at = NULL
      WHERE status = 'PROCESSING'
        AND claimed_at < now() - make_interval(secs => ${STUCK_AFTER_SECONDS})`;
  }

  /** Retention (docs/10 §8): PROCESSED >7 ngày, FAILED >90 ngày. Night-audit gọi. */
  async purgeOld(): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM outbox_events
      WHERE (status = 'PROCESSED' AND processed_at < now() - make_interval(days => ${PROCESSED_RETENTION_DAYS}))
         OR (status = 'FAILED'    AND created_at   < now() - make_interval(days => ${FAILED_RETENTION_DAYS}))`;
  }
}
