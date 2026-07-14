import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateDiscountCodeRequest,
  DiscountCodeResponse,
  UpdateDiscountCodeRequest,
} from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/**
 * Mã giảm giá (task 2.2 /discounts, docs/19 §3 Đợt 2). Tài nguyên TENANT-GLOBAL
 * (KHÔNG theo property — applicable_property_ids chỉ là bộ lọc áp dụng) nên KHÔNG
 * truyền property_id. BE gate `rate_plan.manage` (OWNER/MANAGER). Mọi mutation
 * invalidate ['discounts'] để list tự refetch.
 */
export function useDiscounts() {
  return useQuery({
    queryKey: ['discounts', 'list'],
    queryFn: () =>
      apiClient.get<{ data: DiscountCodeResponse[] }>('/discount-codes').then((r) => r.data),
  });
}

function useInvalidateDiscounts() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['discounts'] });
  };
}

export function useCreateDiscount() {
  const invalidate = useInvalidateDiscounts();
  return useMutation({
    mutationFn: (body: CreateDiscountCodeRequest) =>
      apiClient.post<{ data: DiscountCodeResponse }>('/discount-codes', body).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useUpdateDiscount() {
  const invalidate = useInvalidateDiscounts();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateDiscountCodeRequest }) =>
      apiClient
        .patch<{ data: DiscountCodeResponse }>(`/discount-codes/${id}`, body)
        .then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useDeleteDiscount() {
  const invalidate = useInvalidateDiscounts();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/discount-codes/${id}`),
    onSuccess: invalidate,
  });
}
