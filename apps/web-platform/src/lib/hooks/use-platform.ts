'use client';

import {
  type PlatformPayment,
  type PlatformPlan,
  type PlatformTenant,
  type PlatformTenantDetail,
  type SubscriptionPaymentStatus,
  type TenantStatus,
  type UpdatePlatformPlanRequest,
  type UpdatePlatformTenantRequest,
} from '@pms/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface Envelope<T> {
  data: T;
}

export const platformKeys = {
  plans: ['platform', 'plans'] as const,
  tenants: (params: TenantListParams) => ['platform', 'tenants', params] as const,
  tenant: (id: string) => ['platform', 'tenant', id] as const,
  payments: (status?: SubscriptionPaymentStatus) => ['platform', 'payments', status ?? 'all'] as const,
};

// ── Gói ───────────────────────────────────────────────────────────────────────

export function usePlans() {
  return useQuery({
    queryKey: platformKeys.plans,
    queryFn: async () => (await apiClient.get<Envelope<PlatformPlan[]>>('/platform/plans')).data,
  });
}

export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: UpdatePlatformPlanRequest }) =>
      (await apiClient.patch<Envelope<PlatformPlan>>(`/platform/plans/${id}`, patch)).data,
    // Sửa gói đổi cả hạn mức tenant đang xem → làm mới hết, không đoán.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform'] }),
  });
}

// ── Tenant ────────────────────────────────────────────────────────────────────

export interface TenantListParams {
  q?: string;
  status?: TenantStatus;
}

export function useTenants(params: TenantListParams) {
  return useQuery({
    queryKey: platformKeys.tenants(params),
    queryFn: async () => {
      const search = new URLSearchParams();
      if (params.q) search.set('q', params.q);
      if (params.status) search.set('status', params.status);
      const qs = search.toString();
      return (
        await apiClient.get<Envelope<{ items: PlatformTenant[]; total: number }>>(
          `/platform/tenants${qs ? `?${qs}` : ''}`,
        )
      ).data;
    },
  });
}

export function useTenant(id: string) {
  return useQuery({
    queryKey: platformKeys.tenant(id),
    queryFn: async () =>
      (await apiClient.get<Envelope<PlatformTenantDetail>>(`/platform/tenants/${id}`)).data,
  });
}

export function useUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: UpdatePlatformTenantRequest }) =>
      (await apiClient.patch<Envelope<PlatformTenant>>(`/platform/tenants/${id}`, patch)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform'] }),
  });
}

// ── Thanh toán thuê bao ───────────────────────────────────────────────────────

export function usePayments(status?: SubscriptionPaymentStatus) {
  return useQuery({
    queryKey: platformKeys.payments(status),
    queryFn: async () =>
      (
        await apiClient.get<Envelope<PlatformPayment[]>>(
          `/platform/subscription-payments${status ? `?status=${status}` : ''}`,
        )
      ).data,
  });
}

export function useConfirmPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      await apiClient.post(`/platform/subscription-payments/${id}/confirm`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform'] }),
  });
}
