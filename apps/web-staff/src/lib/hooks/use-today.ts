'use client';

import { useQuery } from '@tanstack/react-query';
import type { TodayBoardResponse } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/** T2 — bảng hôm nay (đến/đi/đang ở). Key `['today']` → SSE booking/payment invalidate. */
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
