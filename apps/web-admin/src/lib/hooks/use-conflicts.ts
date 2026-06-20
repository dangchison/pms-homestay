import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

/**
 * Số xung đột OTA gần đây của cơ sở (GET /channels/conflict-count) — cảnh báo
 * Dashboard "Xung đột OTA". Key `['channels',...]` → SSE booking.* invalidate.
 */
export function useConflictCount(propertyId: string | null) {
  return useQuery({
    queryKey: ['channels', 'conflict-count', propertyId ?? ''],
    queryFn: () =>
      apiClient
        .get<{ data: { conflict_count: number } }>(`/channels/conflict-count?property_id=${propertyId!}`)
        .then((r) => r.data.conflict_count),
    enabled: !!propertyId,
  });
}
