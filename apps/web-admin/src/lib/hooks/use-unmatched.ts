import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UnmatchedPaymentResponse } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/** F4 — biến động ngân hàng chưa khớp. Key `['payments','unmatched']` → SSE payment.* invalidate. */
export function useUnmatched() {
  return useQuery({
    queryKey: ['payments', 'unmatched'],
    queryFn: () =>
      apiClient.get<{ data: UnmatchedPaymentResponse[] }>('/payments/unmatched').then((r) => r.data),
  });
}

export function useResolveUnmatched() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, invoiceId }: { id: string; invoiceId: string }) =>
      apiClient
        .post<{ data: UnmatchedPaymentResponse }>(`/payments/unmatched/${id}/resolve`, { invoice_id: invoiceId })
        .then((r) => r.data),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['payments'] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}

export function useIgnoreUnmatched() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<{ data: UnmatchedPaymentResponse }>(`/payments/unmatched/${id}/ignore`).then((r) => r.data),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['payments'] }),
  });
}
