import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidateForEvent } from './use-events';

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Wiring chuông TopBar (task 2.1): KHÔNG có event_type "notification.dot" trong
 * outbox → MỌI domain event phải invalidate ['notifications'] (nếu không badge sẽ
 * KHÔNG bao giờ cập nhật). Kiểm 1 event có map key khác (booking.created) + 1 event
 * KHÔNG map key nào khác (sync_job.failed) — cả hai đều phải làm mới ['notifications'].
 */
describe('invalidateForEvent → luôn seed ["notifications"]', () => {
  it.each(['booking.created', 'sync_job.failed'])('%s invalidate ["notifications"]', (eventType) => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);
    invalidateForEvent(qc, eventType);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['notifications'] });
  });

  /**
   * Mọi event đều phải đi qua invalidateQueries CÓ queryKey. Từng có sự cố ở nhánh
   * reconnect gọi invalidateQueries() KHÔNG tham số — dạng đó đánh stale toàn bộ
   * cache, kể cả query inactive, nên tốn hàng chục request mỗi 15 phút.
   */
  it('không bao giờ invalidate toàn bộ cache (gọi thiếu queryKey)', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);
    invalidateForEvent(qc, 'payment.received');
    expect(spy).toHaveBeenCalled();
    for (const [arg] of spy.mock.calls) {
      expect(arg, 'invalidateQueries phải luôn kèm queryKey').toHaveProperty('queryKey');
    }
  });
});
