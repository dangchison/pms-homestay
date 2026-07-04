import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssignCleaningTaskRequest,
  CleaningTaskResponse,
  CompleteCleaningTaskRequest,
  OffsetPageInfo,
  StartCleaningTaskRequest,
  VerifyCleaningTaskRequest,
} from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/**
 * Task 1.5 (docs/19 §2 Đợt 1) — việc dọn phòng cho web-admin (điều phối). Port từ
 * web-staff use-cleaning.ts nhưng: (1) invalidate `['rooms']` thay `['rooms-board']`
 * (web-admin dùng useRoomsBoard key `['rooms','board']`); (2) thêm useAssignCleaning /
 * useVerifyCleaning cho điều phối viên. queryKey prefix `['cleaning', ...]` để khớp SSE
 * map trong use-events.ts (`eventType.startsWith('cleaning')` → invalidate `['cleaning']`).
 */

/** Danh sách task theo cơ sở (lọc tuỳ chọn status/assigned_to). Board phân cột client-side. */
export function useCleaningTasks(
  propertyId: string | null,
  opts?: { status?: string; assignedTo?: string },
) {
  return useQuery({
    queryKey: ['cleaning', 'list', propertyId ?? '', opts?.status ?? '', opts?.assignedTo ?? ''],
    queryFn: () => {
      const p = new URLSearchParams({ property_id: propertyId! });
      if (opts?.status) p.set('status', opts.status);
      if (opts?.assignedTo) p.set('assigned_to', opts.assignedTo);
      return apiClient
        .get<{ data: CleaningTaskResponse[]; page_info: OffsetPageInfo }>(
          `/cleaning-tasks?${p.toString()}`,
        )
        .then((r) => r.data);
    },
    enabled: !!propertyId,
  });
}

/** Chi tiết 1 task. */
export function useCleaningTask(id: string) {
  return useQuery({
    queryKey: ['cleaning', id],
    queryFn: () => apiClient.get<{ data: CleaningTaskResponse }>(`/cleaning-tasks/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

/** Bắt đầu dọn (PENDING→IN_PROGRESS). */
export function useStartCleaning(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: StartCleaningTaskRequest) =>
      apiClient.post<{ data: CleaningTaskResponse }>(`/cleaning-tasks/${id}/start`, body).then((r) => r.data),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['cleaning'] });
      void qc.invalidateQueries({ queryKey: ['rooms'] });
    },
  });
}

/** Hoàn tất dọn (IN_PROGRESS→COMPLETED). */
export function useCompleteCleaning(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CompleteCleaningTaskRequest) =>
      apiClient.post<{ data: CleaningTaskResponse }>(`/cleaning-tasks/${id}/complete`, body).then((r) => r.data),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['cleaning'] });
      void qc.invalidateQueries({ queryKey: ['rooms'] });
    },
  });
}

/** Gán/đổi người dọn (status giữ nguyên) — cần quyền cleaning_task.assign. */
export function useAssignCleaning(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AssignCleaningTaskRequest) =>
      apiClient.post<{ data: CleaningTaskResponse }>(`/cleaning-tasks/${id}/assign`, body).then((r) => r.data),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['cleaning'] });
      void qc.invalidateQueries({ queryKey: ['rooms'] });
    },
  });
}

/** Nghiệm thu (COMPLETED→VERIFIED) — phòng về CLEAN; cần quyền cleaning_task.assign. */
export function useVerifyCleaning(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: VerifyCleaningTaskRequest) =>
      apiClient.post<{ data: CleaningTaskResponse }>(`/cleaning-tasks/${id}/verify`, body).then((r) => r.data),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['cleaning'] });
      void qc.invalidateQueries({ queryKey: ['rooms'] });
    },
  });
}
