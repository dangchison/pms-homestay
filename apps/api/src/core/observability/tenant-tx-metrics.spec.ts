import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportTenantTx, setTenantTxObserver, type TenantTxEvent } from './tenant-tx-metrics';

describe('tenant-tx-metrics (docs/18 D2)', () => {
  afterEach(() => setTenantTxObserver(undefined));

  it('no-op khi chưa đăng ký observer (DB_SLOW_TX_LOG_MS tắt)', () => {
    expect(() => reportTenantTx({ tenantId: 't', durationMs: 5, readOnly: false })).not.toThrow();
  });

  it('chuyển đúng event cho observer đã đăng ký', () => {
    const seen: TenantTxEvent[] = [];
    setTenantTxObserver((e) => seen.push(e));
    reportTenantTx({ tenantId: 'abc', durationMs: 1234, readOnly: true });
    expect(seen).toEqual([{ tenantId: 'abc', durationMs: 1234, readOnly: true }]);
  });

  it('NUỐT lỗi observer — quan trắc không bao giờ làm vỡ giao dịch', () => {
    setTenantTxObserver(() => {
      throw new Error('observer hỏng');
    });
    expect(() => reportTenantTx({ tenantId: 't', durationMs: 9, readOnly: false })).not.toThrow();
  });

  it('gỡ observer bằng undefined → ngừng nhận event', () => {
    const fn = vi.fn();
    setTenantTxObserver(fn);
    setTenantTxObserver(undefined);
    reportTenantTx({ tenantId: 't', durationMs: 1, readOnly: false });
    expect(fn).not.toHaveBeenCalled();
  });
});
