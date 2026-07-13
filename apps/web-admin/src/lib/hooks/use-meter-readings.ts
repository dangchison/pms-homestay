import { useQuery } from '@tanstack/react-query';
import type { MeterReadingResponse } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/**
 * Chỉ số điện/nước thuê tháng của 1 booking (task 2.7, docs/19 §3 Đợt 2 — task BE 3.8).
 * CHỈ fetch khi enabled=true — page gate theo booking.mode==='MONTHLY' để KHÔNG gọi
 * /meter-readings cho booking thường (BE trả [] nhưng vẫn gate cho đúng ý đồ + đỡ request).
 * queryKey ['meter-readings', bookingId].
 */
export function useMeterReadings(bookingId: string, opts: { enabled: boolean }) {
  return useQuery({
    queryKey: ['meter-readings', bookingId],
    queryFn: () =>
      apiClient
        .get<{ data: MeterReadingResponse[] }>(`/meter-readings?booking_id=${bookingId}`)
        .then((r) => r.data),
    enabled: opts.enabled,
  });
}
