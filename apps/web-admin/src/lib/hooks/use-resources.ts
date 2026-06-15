import { useQuery } from '@tanstack/react-query';
import type { BookableResourceResponse } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/** Danh sách resource (ROOM + WHOLE) của một cơ sở — cho ResourcePicker (task 6.3). */
export function useResources(propertyId: string | null) {
  return useQuery({
    queryKey: ['resources', propertyId ?? ''],
    queryFn: () =>
      apiClient
        .get<{ data: BookableResourceResponse[] }>(`/bookable-resources?property_id=${propertyId}`)
        .then((r) => r.data),
    enabled: !!propertyId,
  });
}
