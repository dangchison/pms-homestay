import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;
export type DocumentType = 'BK' | 'INV';

/**
 * ★ DocumentCounterService (docs/03 §1.4, task 3.1) — sinh số chứng từ ATOMIC,
 * KHÔNG gap, reset theo (tenant, type, period). UPSERT + RETURNING khoá row →
 * concurrent serialize. Gọi TRONG tx của entity (booking/invoice) để cùng commit/rollback.
 */
@Injectable()
export class DocumentCounterService {
  /** Tăng & trả giá trị kế tiếp cho (tenant, type, period). */
  async next(tx: Tx, tenantId: string, documentType: DocumentType, period: string): Promise<number> {
    const rows = await tx.$queryRaw<{ current_value: number }[]>(Prisma.sql`
      INSERT INTO document_counters (tenant_id, document_type, period, current_value)
      VALUES (${tenantId}::uuid, ${documentType}, ${period}, 1)
      ON CONFLICT (tenant_id, document_type, period)
      DO UPDATE SET current_value = document_counters.current_value + 1
      RETURNING current_value
    `);
    return Number(rows[0]!.current_value);
  }

  /** Số chứng từ đầy đủ, vd BK-202606-0001. period 'YYYYMM'. */
  async nextCode(
    tx: Tx,
    tenantId: string,
    documentType: DocumentType,
    period: string,
  ): Promise<string> {
    const value = await this.next(tx, tenantId, documentType, period);
    return `${documentType}-${period}-${String(value).padStart(4, '0')}`;
  }
}

/** 'YYYYMM' của một thời điểm theo UTC (đủ cho mã chứng từ — không cần TZ chính xác). */
export function periodOf(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
