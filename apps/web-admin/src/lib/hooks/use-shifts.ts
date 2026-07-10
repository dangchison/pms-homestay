import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CloseShiftRequest,
  OffsetPageInfo,
  OpenShiftRequest,
  ShiftDetailResponse,
  ShiftResponse,
} from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/**
 * Sổ quỹ ca (task 2.3 /shifts, docs/19 §3 Đợt 2). BE: đọc (list/detail) cần
 * `report.financial`; mở/đóng ca cần `payment.reconcile` (+ authorizeOnProperty).
 * KHÔNG có SSE cho shifts → realtime dựa onSuccess invalidate `['shifts']` sau
 * open/close (đủ cho thao tác người dùng tự thân, như use-channels). `variance_vnd`
 * và `expected_cash_vnd` là cột server-computed (GENERATED STORED, schema cash_shifts)
 * → CHỈ đọc từ response; TUYỆT ĐỐI không gửi trong body open/close.
 */

export interface ShiftFilters {
  status?: string;
  page?: number;
}

/** Danh sách ca theo cơ sở + filter (mẫu `useInvoices`). Key prefix `['shifts']` → open/close invalidate refetch. */
export function useShifts(propertyId: string | null, filters: ShiftFilters = {}) {
  return useQuery({
    queryKey: ['shifts', 'list', propertyId ?? '', filters],
    queryFn: () => {
      const p = new URLSearchParams({ property_id: propertyId!, page: String(filters.page ?? 1) });
      if (filters.status) p.set('status', filters.status);
      return apiClient.get<{ data: ShiftResponse[]; page_info: OffsetPageInfo }>(`/shifts?${p.toString()}`);
    },
    enabled: !!propertyId,
    placeholderData: keepPreviousData,
  });
}

/** Chi tiết 1 ca + payment CASH thuộc cửa sổ ca. Key `['shifts', id]` (prefix `['shifts']` → invalidate). */
export function useShift(id: string) {
  return useQuery({
    queryKey: ['shifts', id],
    queryFn: () => apiClient.get<{ data: ShiftDetailResponse }>(`/shifts/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

/**
 * Mở ca: POST /shifts + Idempotency-Key (replay trả đúng ca cũ). body chỉ gồm
 * property_id/opening_float_vnd/note — KHÔNG variance/expected (server tính). Component
 * xử lý 409 SHIFT_ALREADY_OPEN (đã có ca OPEN ở cơ sở). onSuccess invalidate ['shifts'].
 */
export function useOpenShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: OpenShiftRequest; idempotencyKey: string }) =>
      apiClient
        .post<{ data: ShiftResponse }>('/shifts', body, { headers: { 'Idempotency-Key': idempotencyKey } })
        .then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['shifts'] }),
  });
}

/**
 * Đóng ca: POST /shifts/:id/close + If-Match=version (optimistic lock). body gồm
 * closing_counted_vnd/note — KHÔNG variance/expected (server tính). Component xử lý
 * 409 VERSION_CONFLICT / 422 SHIFT_NOT_OPEN → refetch + báo. onSuccess invalidate ['shifts'].
 */
export function useCloseShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version, body }: { id: string; version: number; body: CloseShiftRequest }) =>
      apiClient
        .post<{ data: ShiftResponse }>(`/shifts/${id}/close`, body, { headers: { 'If-Match': String(version) } })
        .then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['shifts'] }),
  });
}
