import { useQuery } from '@tanstack/react-query';
import type { RatePlanResponse } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/** Gói giá của cơ sở — dùng cho onboarding D1 ("đã cấu hình gói giá chưa"). */
export function useRatePlans(propertyId: string | null) {
  return useQuery({
    queryKey: ['rate-plans', propertyId ?? ''],
    queryFn: () =>
      apiClient.get<{ data: RatePlanResponse[] }>(`/rate-plans?property_id=${propertyId!}`).then((r) => r.data),
    enabled: !!propertyId,
  });
}
