import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Tenant, UpdateTenantRequest } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/** S1 — hồ sơ tenant. */
export function useTenant() {
  return useQuery({
    queryKey: ['tenant'],
    queryFn: () => apiClient.get<{ data: Tenant }>('/tenant').then((r) => r.data),
  });
}

export function useUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateTenantRequest) =>
      apiClient.patch<{ data: Tenant }>('/tenant', body).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant'] }),
  });
}
