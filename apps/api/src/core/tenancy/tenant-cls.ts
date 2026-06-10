import { AsyncLocalStorage } from 'node:async_hooks';
import { type Prisma } from '@prisma/client';

/**
 * CLS (AsyncLocalStorage) giữ tenant context + transaction client trong suốt
 * một unit-of-work withTenant — service sâu bên trong không cần chuyền tx tay
 * (ADR-0002, docs/02 §withTenant).
 */
export interface TenantContext {
  tenantId: string;
  tx: Prisma.TransactionClient;
}

export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

/** Transaction client của unit-of-work hiện tại — ném lỗi nếu gọi ngoài withTenant. */
export function currentTenantTx(): Prisma.TransactionClient {
  const ctx = tenantContextStorage.getStore();
  if (!ctx) {
    throw new Error(
      'Đang ở ngoài withTenant context — mọi truy vấn bảng tenant-scoped phải bọc trong withTenant() (ADR-0002)',
    );
  }
  return ctx.tx;
}

export function currentTenantId(): string | undefined {
  return tenantContextStorage.getStore()?.tenantId;
}
