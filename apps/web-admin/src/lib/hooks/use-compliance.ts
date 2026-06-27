import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConsentResponse, DataErasureResponse } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';
import { downloadBlob } from '@/lib/download';

/** S6 — báo cáo lưu trú TT56 (xlsx). */
export function useDownloadPoliceReport() {
  return useMutation({
    mutationFn: ({ propertyId, from, to }: { propertyId: string; from: string; to: string }) =>
      downloadBlob(
        `/compliance/police-report?property_id=${propertyId}&from=${from}&to=${to}`,
        `bao-cao-luu-tru-${from}_${to}.xlsx`,
      ),
  });
}

/** S6 — consents của 1 khách. */
export function useConsents(guestId: string | null) {
  return useQuery({
    queryKey: ['consents', guestId ?? ''],
    queryFn: () =>
      apiClient.get<{ data: ConsentResponse[] }>(`/guests/${guestId}/consents`).then((r) => r.data),
    enabled: !!guestId,
  });
}

export function useRevokeConsent(guestId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (consentId: string) =>
      apiClient.post(`/guests/${guestId}/consents/${consentId}/revoke`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['consents', guestId] }),
  });
}

/** S6 — xuất dữ liệu khách (zip). */
export function useDownloadGuestExport() {
  return useMutation({
    mutationFn: (guestId: string) =>
      downloadBlob(`/guests/${guestId}/data-export`, `du-lieu-khach-${guestId}.zip`),
  });
}

/** S6 — ẩn danh khách (NĐ13) — trả legal-hold matrix. */
export function useEraseGuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (guestId: string) =>
      apiClient.post<{ data: DataErasureResponse }>(`/guests/${guestId}/data-erasure`).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['guests'] }),
  });
}
