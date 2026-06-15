import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePaymentRequest,
  InvoiceResponse,
  OffsetPageInfo,
  PaymentResponse,
  RefundPaymentRequest,
} from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

export interface InvoiceFilters {
  status?: string;
  kind?: string;
  page?: number;
}

/** F1 — danh sách hoá đơn theo cơ sở + filter (task 6.4). */
export function useInvoices(propertyId: string | null, filters: InvoiceFilters) {
  return useQuery({
    queryKey: ['invoices', 'list', propertyId ?? '', filters],
    queryFn: () => {
      const p = new URLSearchParams({ property_id: propertyId!, page: String(filters.page ?? 1) });
      if (filters.status) p.set('status', filters.status);
      if (filters.kind) p.set('kind', filters.kind);
      return apiClient.get<{ data: InvoiceResponse[]; page_info: OffsetPageInfo }>(`/invoices?${p.toString()}`);
    },
    enabled: !!propertyId,
    placeholderData: keepPreviousData,
  });
}

/** F2 — chi tiết hoá đơn. Key `['invoices', id]` → SSE payment/invoice events invalidate (tick realtime). */
export function useInvoice(id: string) {
  return useQuery({
    queryKey: ['invoices', id],
    queryFn: () => apiClient.get<{ data: InvoiceResponse }>(`/invoices/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

/** Payment của 1 hoá đơn (F2: list + refund picker). Key `['payments', ...]` → SSE invalidate. */
export function usePaymentsByInvoice(invoiceId: string) {
  return useQuery({
    queryKey: ['payments', 'invoice', invoiceId],
    queryFn: () =>
      apiClient.get<{ data: PaymentResponse[] }>(`/payments?invoice_id=${invoiceId}`).then((r) => r.data),
    enabled: !!invoiceId,
  });
}

export function useRecordPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: CreatePaymentRequest; idempotencyKey: string }) =>
      apiClient
        .post<{ data: PaymentResponse }>('/payments', body, { headers: { 'Idempotency-Key': idempotencyKey } })
        .then((r) => r.data),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['invoices'] }),
  });
}

export function useRefundPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, body }: { paymentId: string; body: RefundPaymentRequest }) =>
      apiClient.post<{ data: PaymentResponse }>(`/payments/${paymentId}/refund`, body).then((r) => r.data),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['invoices'] }),
  });
}

export function useVoidInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.post<{ data: InvoiceResponse }>(`/invoices/${id}/void`, { reason }).then((r) => r.data),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['invoices'] }),
  });
}

export function useIssueInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<{ data: InvoiceResponse }>(`/invoices/${id}/issue`).then((r) => r.data),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['invoices'] }),
  });
}
