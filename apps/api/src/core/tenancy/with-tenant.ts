import { type Prisma, type PrismaClient } from '@prisma/client';
import { softDeleteExtension } from '@core/prisma/soft-delete.extension';
import { tenantContextStorage } from './tenant-cls';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Client đã gắn soft-delete extension — cache theo client gốc (task 1.6). */
const extendedCache = new WeakMap<PrismaClient, PrismaClient>();

function withSoftDelete(prisma: PrismaClient): PrismaClient {
  let extended = extendedCache.get(prisma);
  if (!extended) {
    // $extends trả type mở rộng — về mặt API vẫn là PrismaClient (không thêm method)
    extended = prisma.$extends(softDeleteExtension) as unknown as PrismaClient;
    extendedCache.set(prisma, extended);
  }
  return extended;
}

export interface WithTenantOptions {
  /** GET/read path: ép transaction READ ONLY ở DB */
  readOnly?: boolean;
}

/**
 * ★ Unit-of-work helper (ADR-0002, docs/02 §3) — đường DUY NHẤT để chạm bảng
 * tenant-scoped:
 *
 *   await withTenant(prisma, tenantId, async (tx) => {
 *     return tx.bookings.findMany(...);   // RLS context đã set
 *   });
 *
 * - Mở interactive transaction; câu lệnh ĐẦU TIÊN là
 *   `SELECT set_config('app.current_tenant_id', $1, true)` — GUC scope LOCAL,
 *   tự reset khi tx kết thúc → an toàn với pooler transaction-mode.
 * - Transaction = MỘT unit-of-work ngắn, KHÔNG phải request lifecycle.
 * - CẤM external I/O (HTTP/S3/OCR/email) bên trong fn — giữ tx ngắn
 *   (ADR-0002 amendment); đẩy side-effect ra ngoài hoặc qua outbox.
 * - fn nhận tx tường minh; đồng thời tx có sẵn qua CLS (currentTenantTx()).
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts?: WithTenantOptions,
): Promise<T> {
  if (!UUID_RE.test(tenantId)) {
    throw new Error(`withTenant: tenantId không phải UUID hợp lệ: "${tenantId}"`);
  }

  return withSoftDelete(prisma).$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        tenantId,
      );
      if (opts?.readOnly) {
        await tx.$executeRawUnsafe(`SET TRANSACTION READ ONLY`);
      }
      return tenantContextStorage.run({ tenantId, tx }, () => fn(tx));
    },
    { maxWait: 2_000, timeout: 10_000 },
  );
}
