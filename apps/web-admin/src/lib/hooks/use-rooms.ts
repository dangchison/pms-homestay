import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateRoomRequest,
  RoomResponse,
  UpdateHousekeepingRequest,
} from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/**
 * Phòng VẬT LÝ của một cơ sở (task 1.3 /properties tab "Phòng"). Key `['rooms', 'list', ...]`
 * → SSE room.* invalidate ['rooms'] (use-events.ts) cho realtime housekeeping.
 */
export function useRooms(propertyId: string | null) {
  return useQuery({
    queryKey: ['rooms', 'list', propertyId ?? ''],
    queryFn: () =>
      apiClient
        .get<{ data: RoomResponse[] }>(`/rooms?property_id=${propertyId}`)
        .then((r) => r.data),
    enabled: !!propertyId,
  });
}

/** Tạo phòng (tự sinh resource ROOM 1:1 ở BE — ADR-0006). */
export function useCreateRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRoomRequest) =>
      apiClient.post<{ data: RoomResponse }>('/rooms', body).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['rooms'] }),
  });
}

/** Đổi nhanh trạng thái buồng phòng (KHÔNG If-Match — low-stakes, idempotent). */
export function useUpdateHousekeeping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, housekeeping_status }: { id: string } & UpdateHousekeepingRequest) =>
      apiClient
        .patch<{ data: RoomResponse }>(`/rooms/${id}/housekeeping`, { housekeeping_status })
        .then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['rooms'] }),
  });
}
