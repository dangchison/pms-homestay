import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChargeSubscriptionResponse,
  SubscriptionPaymentResponse,
  SubscriptionPlan,
  SubscriptionSummaryResponse,
} from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/** S3 — gói hiện tại + usage. Key `['billing']` → SSE/refresh sau confirm. */
export function useSubscription() {
  return useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: () =>
      apiClient.get<{ data: SubscriptionSummaryResponse }>('/billing/subscription').then((r) => r.data),
  });
}

export function usePlans() {
  return useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: () => apiClient.get<{ data: SubscriptionPlan[] }>('/billing/plans').then((r) => r.data),
  });
}

export function usePayments() {
  return useQuery({
    queryKey: ['billing', 'payments'],
    queryFn: () =>
      apiClient.get<{ data: SubscriptionPaymentResponse[] }>('/billing/payments').then((r) => r.data),
  });
}

export function useCharge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (planCode: string) =>
      apiClient
        .post<{ data: ChargeSubscriptionResponse }>('/billing/charge', { plan_code: planCode })
        .then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['billing'] }),
  });
}
