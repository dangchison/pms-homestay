import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChangePasswordRequest, SessionInfo } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

interface TwoFaEnrollment {
  secret: string;
  otpauth_url: string;
  backup_codes: string[];
}

/** S4 — phiên đăng nhập đang hoạt động. */
export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => apiClient.get<{ data: SessionInfo[] }>('/auth/sessions').then((r) => r.data),
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/auth/sessions/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: ChangePasswordRequest) => apiClient.post('/auth/change-password', body),
  });
}

export function use2faEnable() {
  return useMutation({
    mutationFn: () => apiClient.post<{ data: TwoFaEnrollment }>('/auth/2fa/enable').then((r) => r.data),
  });
}

export function use2faVerify() {
  return useMutation({
    mutationFn: (totpCode: string) => apiClient.post('/auth/2fa/verify', { totp_code: totpCode }),
  });
}

export function use2faDisable() {
  return useMutation({
    mutationFn: (totpCode: string) => apiClient.post('/auth/2fa/disable', { totp_code: totpCode }),
  });
}
