import { useQuery } from '@tanstack/react-query';
import { type PropertyResponse } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/**
 * Data-hook tách khỏi component hiển thị (docs/ui/00 §4.5). Danh sách cơ sở cho
 * PropertySwitcher. SSE chỉ invalidate; REST là nguồn sự thật.
 */
export function useProperties() {
  return useQuery({
    queryKey: ['properties'],
    queryFn: () => apiClient.get<{ data: PropertyResponse[] }>('/properties').then((r) => r.data),
  });
}
