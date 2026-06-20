import { useQuery } from '@tanstack/react-query';
import type { TodayBoardResponse } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/**
 * Data-hook "hôm nay của cơ sở" cho Dashboard (D1) — GET /bookings/today (task
 * 6.6). Trả arrivals/departures/in_house. SSE (`useEvents`) invalidate prefix
 * `['today']` khi có sự kiện booking/payment → KPI cập nhật realtime.
 */
export function useTodayBoard(propertyId: string | null) {
  return useQuery({
    queryKey: ['today', propertyId ?? ''],
    queryFn: () =>
      apiClient
        .get<{ data: TodayBoardResponse }>(`/bookings/today?property_id=${propertyId!}`)
        .then((r) => r.data),
    enabled: !!propertyId,
  });
}
