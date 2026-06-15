'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CleaningTaskResponse,
  CompleteCleaningTaskRequest,
  CreateCleaningTaskRequest,
  OffsetPageInfo,
  PresignPhotoRequest,
  PresignPhotoResponse,
  StartCleaningTaskRequest,
} from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

/** T5 — task dọn phòng. HOUSEKEEPER chỉ xem task của mình (assigned_to=me). */
export function useCleaningTasks(propertyId: string | null, opts?: { status?: string; mineOnly?: boolean }) {
  const userId = useAuthStore((s) => s.user?.id);
  return useQuery({
    queryKey: ['cleaning', 'list', propertyId ?? '', opts?.status ?? '', opts?.mineOnly ? userId : 'all'],
    queryFn: () => {
      const p = new URLSearchParams({ property_id: propertyId! });
      if (opts?.status) p.set('status', opts.status);
      if (opts?.mineOnly && userId) p.set('assigned_to', userId);
      return apiClient
        .get<{ data: CleaningTaskResponse[]; page_info: OffsetPageInfo }>(`/cleaning-tasks?${p.toString()}`)
        .then((r) => r.data);
    },
    enabled: !!propertyId,
  });
}

/** T6 — chi tiết task. */
export function useCleaningTask(id: string) {
  return useQuery({
    queryKey: ['cleaning', id],
    queryFn: () => apiClient.get<{ data: CleaningTaskResponse }>(`/cleaning-tasks/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useStartCleaning(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: StartCleaningTaskRequest) =>
      apiClient.post<{ data: CleaningTaskResponse }>(`/cleaning-tasks/${id}/start`, body).then((r) => r.data),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['cleaning'] }),
  });
}

export function useCompleteCleaning(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CompleteCleaningTaskRequest) =>
      apiClient.post<{ data: CleaningTaskResponse }>(`/cleaning-tasks/${id}/complete`, body).then((r) => r.data),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['cleaning'] });
      void qc.invalidateQueries({ queryKey: ['rooms-board'] });
    },
  });
}

/** Tạo việc dọn thủ công từ room board (DEEP_CLEAN/MAINTENANCE). */
export function useCreateCleaningTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCleaningTaskRequest) =>
      apiClient.post<{ data: CleaningTaskResponse }>('/cleaning-tasks', body).then((r) => r.data),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['cleaning'] }),
  });
}

/** Xin URL pre-signed cho 1 ảnh (before/after). */
export function presignCleaningPhoto(taskId: string, body: PresignPhotoRequest): Promise<PresignPhotoResponse> {
  return apiClient
    .post<{ data: PresignPhotoResponse }>(`/cleaning-tasks/${taskId}/photos/presign`, body)
    .then((r) => r.data);
}
