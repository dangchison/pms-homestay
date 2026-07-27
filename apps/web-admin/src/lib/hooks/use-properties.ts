import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePropertyRequest,
  PropertyResponse,
  UpdatePropertyRequest,
} from '@pms/shared-types';
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

/** Chi tiết một cơ sở — cho tab "Thông tin cơ sở". */
export function useProperty(id: string | null) {
  return useQuery({
    queryKey: ['properties', 'detail', id ?? ''],
    queryFn: () =>
      apiClient.get<{ data: PropertyResponse }>(`/properties/${id!}`).then((r) => r.data),
    enabled: !!id,
  });
}

/**
 * Tạo cơ sở. Vượt hạn mức gói → 422 `PLAN_LIMIT_REACHED` (guard chạy trong tx ở BE)
 * — caller nên bắt riêng mã này để mời nâng gói thay vì đổ toast lỗi chung chung.
 */
export function useCreateProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePropertyRequest) =>
      apiClient.post<{ data: PropertyResponse }>('/properties', body).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['properties'] }),
  });
}

export function useUpdateProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & UpdatePropertyRequest) =>
      apiClient.patch<{ data: PropertyResponse }>(`/properties/${id}`, body).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['properties'] }),
  });
}
