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
});
