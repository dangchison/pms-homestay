import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateExpenseRequest,
  ExpenseResponse,
  OffsetPageInfo,
  UpdateExpenseRequest,
} from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

export interface ExpenseFilters {
  expense_type?: string;
  from?: string;
  to?: string;
  page?: number;
}

/**
 * Chi phí vận hành (task 2.5 /expenses, docs/19 §3 Đợt 2). BE CRUD cần `expense.crud`
 * (+ authorizeOnProperty). Chi phí ảnh hưởng P&L ⇒ mutation invalidate CẢ ['expenses']
 * lẫn ['reports']. Hoa hồng OTA (OTA_COMMISSION) do hệ thống tự sinh — KHÔNG nhập tay.
 */
export function useExpenses(propertyId: string | null, filters: ExpenseFilters = {}) {
  return useQuery({
    queryKey: ['expenses', 'list', propertyId ?? '', filters],
    queryFn: () => {
      const p = new URLSearchParams({ property_id: propertyId!, page: String(filters.page ?? 1) });
      if (filters.expense_type) p.set('expense_type', filters.expense_type);
      if (filters.from) p.set('from', filters.from);
      if (filters.to) p.set('to', filters.to);
      return apiClient.get<{ data: ExpenseResponse[]; page_info: OffsetPageInfo }>(
        `/expenses?${p.toString()}`,
      );
    },
    enabled: !!propertyId,
    placeholderData: keepPreviousData,
  });
}

/** Chi phí đổi → P&L đổi: invalidate cả ['expenses'] và ['reports']. */
function useInvalidateExpenses() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['expenses'] });
    void qc.invalidateQueries({ queryKey: ['reports'] });
  };
}

export function useCreateExpense() {
  const invalidate = useInvalidateExpenses();
  return useMutation({
    mutationFn: (body: CreateExpenseRequest) =>
      apiClient.post<{ data: ExpenseResponse }>('/expenses', body).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useUpdateExpense() {
  const invalidate = useInvalidateExpenses();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateExpenseRequest }) =>
      apiClient.patch<{ data: ExpenseResponse }>(`/expenses/${id}`, body).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useDeleteExpense() {
  const invalidate = useInvalidateExpenses();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/expenses/${id}`),
    onSuccess: invalidate,
  });
}
