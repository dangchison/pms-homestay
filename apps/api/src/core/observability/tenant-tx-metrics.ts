/**
 * Quan trắc cost theo tenant (docs/18 D2 — noisy-neighbor; docs/02 §11).
 *
 * `withTenant` báo thời lượng MỖI unit-of-work qua observer hook toàn cục; bộ ghi
 * log (AppLoggerModule) đăng ký observer khi `DB_SLOW_TX_LOG_MS > 0`. Tách hook ra
 * khỏi `with-tenant.ts` để giữ util thuần (không phụ thuộc logger/DI) và để test
 * tiêm observer giả. Khi chưa đăng ký → `reportTenantTx` là no-op (zero overhead
 * ngoài 2 lần Date.now()).
 */
export interface TenantTxEvent {
  tenantId: string;
  durationMs: number;
  readOnly: boolean;
}

export type TenantTxObserver = (event: TenantTxEvent) => void;

let observer: TenantTxObserver | undefined;

/** Đăng ký (hoặc gỡ bằng `undefined`) observer toàn cục. Gọi 1 lần lúc bootstrap. */
export function setTenantTxObserver(next: TenantTxObserver | undefined): void {
  observer = next;
}

/**
 * `with-tenant` gọi sau mỗi unit-of-work (kể cả khi tx ném lỗi → vẫn đo được tx
 * chậm rồi fail). Nuốt MỌI lỗi observer — quan trắc KHÔNG được làm vỡ giao dịch.
 */
export function reportTenantTx(event: TenantTxEvent): void {
  if (!observer) return;
  try {
    observer(event);
  } catch {
    /* metrics best-effort — bỏ qua */
  }
}
