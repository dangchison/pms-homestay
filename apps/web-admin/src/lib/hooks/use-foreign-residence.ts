import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateForeignResidenceRequest,
  ForeignResidenceResponse,
  SubmitForeignResidenceResponse,
  UpdateForeignResidenceRequest,
} from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';
import { downloadBlob } from '@/lib/download';

/**
 * Khai báo tạm trú khách nước ngoài (NA17, XNC) — task 2.8 (docs/19 §3 Đợt 2). Tài
 * nguyên THEO CƠ SỞ (như báo cáo lưu trú TT56): list lọc theo property_id. BE gate
 * `guest.pii.read` + property-scope. Số thị thực CHỈ trả last4. Mọi mutation invalidate
 * prefix `['foreign-residence']` để list tự refetch (đúng cơ sở đang chọn).
 */
export function useForeignResidences(propertyId: string | null) {
  return useQuery({
    queryKey: ['foreign-residence', propertyId ?? ''],
    queryFn: () =>
      apiClient
        .get<{ data: ForeignResidenceResponse[] }>(
          `/compliance/foreign-residence?property_id=${propertyId!}`,
        )
        .then((r) => r.data),
    enabled: !!propertyId,
  });
}

function useInvalidateForeignResidences() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['foreign-residence'] });
  };
}

export function useCreateForeignResidence() {
  const invalidate = useInvalidateForeignResidences();
  return useMutation({
    mutationFn: (body: CreateForeignResidenceRequest) =>
      apiClient
        .post<{ data: ForeignResidenceResponse }>('/compliance/foreign-residence', body)
        .then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useUpdateForeignResidence() {
  const invalidate = useInvalidateForeignResidences();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateForeignResidenceRequest }) =>
      apiClient
        .patch<{ data: ForeignResidenceResponse }>(`/compliance/foreign-residence/${id}`, body)
        .then((r) => r.data),
    onSuccess: invalidate,
  });
}

/** "Gửi XNC" (DRAFT/FAILED → SUBMITTED). Gửi lại khai báo đã SUBMITTED là idempotent (BE). */
export function useSubmitForeignResidence() {
  const invalidate = useInvalidateForeignResidences();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient
        .post<{ data: SubmitForeignResidenceResponse }>(`/compliance/foreign-residence/${id}/submit`)
        .then((r) => r.data),
    onSuccess: invalidate,
  });
}

/**
 * Tải phiếu NA17 (.xlsx) qua getBlob (Bearer) → downloadBlob. KHÔNG dùng <a href> trực
 * tiếp (mất Bearer). Lỗi → ApiClientError ném ra, component hiện toast (không tạo file rỗng).
 */
export function useDownloadNa17() {
  return useMutation({
    mutationFn: (id: string) =>
      downloadBlob(`/compliance/foreign-residence/${id}/na17`, `na17-${id}.xlsx`),
  });
}
