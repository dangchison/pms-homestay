'use client';

import { useMutation } from '@tanstack/react-query';
import type { CloseShiftRequest, OpenShiftRequest, ShiftResponse } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';
import { useShiftStore } from '@/stores/shift.store';

/**
 * Mở/đóng ca thu ngân (task 2.10b). STAFF thiếu `report.financial` → KHÔNG đọc /shifts;
 * state ca mở giữ ở store cục bộ (localStorage). Mở ca gửi Idempotency-Key; đóng ca gửi
 * If-Match=version. onSuccess ghi/xoá store cục bộ. Lỗi (409/422/404) do UI xử lý.
 */

/** POST /shifts — mở ca. onSuccess lưu ca mở cục bộ theo cơ sở. */
export function useOpenShift() {
  const setOpen = useShiftStore((s) => s.setOpen);
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: OpenShiftRequest; idempotencyKey: string }) =>
      apiClient
        .post<{ data: ShiftResponse }>('/shifts', body, { headers: { 'Idempotency-Key': idempotencyKey } })
        .then((r) => r.data),
    onSuccess: (data) => {
      setOpen(data.property_id, {
        shiftId: data.id,
        version: data.version,
        openingFloatVnd: data.opening_float_vnd,
        openedAt: data.opened_at,
      });
    },
  });
}

/** POST /shifts/:id/close — đóng ca. onSuccess xoá ca mở cục bộ của cơ sở. */
export function useCloseShift() {
  const clearOpen = useShiftStore((s) => s.clearOpen);
  return useMutation({
    mutationFn: ({
      shiftId,
      version,
      body,
    }: {
      shiftId: string;
      propertyId: string;
      version: number;
      body: CloseShiftRequest;
    }) =>
      apiClient
        .post<{ data: ShiftResponse }>(`/shifts/${shiftId}/close`, body, {
          headers: { 'If-Match': String(version) },
        })
        .then((r) => r.data),
    onSuccess: (_data, vars) => {
      clearOpen(vars.propertyId);
    },
  });
}
