import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookableResourceResponse, CreateWholeResourceRequest } from '@pms/shared-types';
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

/** Tạo resource WHOLE (nguyên căn) — chọn ≥1 phòng thành viên (task 1.3). ROOM tự sinh khi tạo phòng. */
export function useCreateWholeResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWholeResourceRequest) =>
      apiClient.post<{ data: BookableResourceResponse }>('/bookable-resources', body).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['resources'] }),
  });
}

