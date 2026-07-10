import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssetResponse,
  CreateAssetRequest,
  DepreciationEntryResponse,
  DisposeAssetRequest,
  OffsetPageInfo,
  UpdateAssetRequest,
} from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/**
 * Tài sản cố định + khấu hao (task 2.6 /assets, docs/19 §3 Đợt 2). BE CRUD cần
 * `asset.crud` (+ authorizeOnProperty). Khấu hao vào P&L ⇒ mutation invalidate CẢ
 * ['assets'] lẫn ['reports']. Tham số tài chính BẤT BIẾN sau tạo — PATCH chỉ sửa mô tả.
 */
export function useAssets(propertyId: string | null, page = 1) {
  return useQuery({
    queryKey: ['assets', 'list', propertyId ?? '', page],
    queryFn: () => {
      const p = new URLSearchParams({ property_id: propertyId!, page: String(page) });
      return apiClient.get<{ data: AssetResponse[]; page_info: OffsetPageInfo }>(
        `/assets?${p.toString()}`,
      );
    },
    enabled: !!propertyId,
    placeholderData: keepPreviousData,
  });
}

/** Sổ khấu hao theo kỳ của 1 tài sản (chỉ tải khi mở dialog). */
export function useAssetDepreciation(id: string | null) {
  return useQuery({
    queryKey: ['assets', id ?? '', 'depreciation'],
    queryFn: () =>
      apiClient
        .get<{ data: DepreciationEntryResponse[] }>(`/assets/${id}/depreciation`)
        .then((r) => r.data),
    enabled: !!id,
  });
}

function useInvalidateAssets() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['assets'] });
    void qc.invalidateQueries({ queryKey: ['reports'] });
  };
}

export function useCreateAsset() {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: (body: CreateAssetRequest) =>
      apiClient.post<{ data: AssetResponse }>('/assets', body).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useUpdateAsset() {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAssetRequest }) =>
      apiClient.patch<{ data: AssetResponse }>(`/assets/${id}`, body).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useDisposeAsset() {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: DisposeAssetRequest }) =>
      apiClient.post<{ data: AssetResponse }>(`/assets/${id}/dispose`, body).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useDeleteAsset() {
  const invalidate = useInvalidateAssets();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/assets/${id}`),
    onSuccess: invalidate,
  });
}
