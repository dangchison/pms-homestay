'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  CreateGuestRequest,
  GuestResponse,
  IdScanPresignRequest,
  IdScanPresignResponse,
  ScanIdResponse,
  UpdateGuestRequest,
} from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

export function useGuest(id: string | null | undefined) {
  return useQuery({
    queryKey: ['guests', id ?? ''],
    queryFn: () => apiClient.get<{ data: GuestResponse }>(`/guests/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

/** T3 ① — xin URL pre-signed để upload ảnh CCCD lên storage tier VN (task 7.1). */
export function presignIdScan(body: IdScanPresignRequest): Promise<IdScanPresignResponse> {
  return apiClient.post<{ data: IdScanPresignResponse }>('/guests/id-scan/presign', body).then((r) => r.data);
}

/** T3 ① — OCR ảnh đã upload → trả extracted (KHÔNG lưu DB ở bước này). */
export function scanId(imageKey: string): Promise<ScanIdResponse> {
  return apiClient.post<{ data: ScanIdResponse }>('/guests/scan-id', { image_key: imageKey }).then((r) => r.data);
}

export function createGuest(body: CreateGuestRequest): Promise<GuestResponse> {
  return apiClient.post<{ data: GuestResponse }>('/guests', body).then((r) => r.data);
}

export function updateGuest(id: string, body: UpdateGuestRequest): Promise<GuestResponse> {
  return apiClient.patch<{ data: GuestResponse }>(`/guests/${id}`, body).then((r) => r.data);
}
