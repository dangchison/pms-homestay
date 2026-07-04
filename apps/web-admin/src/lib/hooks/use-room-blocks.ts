import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateRoomBlockRequest, RoomBlockResponse } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/**
 * Block bảo trì của một phòng (task 1.3 /properties tab "Block bảo trì"). KHÔNG có SSE
 * riêng cho ['room-blocks'] — realtime dựa vào onSuccess invalidate của mutation (đủ cho
 * luồng người dùng tự thao tác; docs/19 §2 risks).
 */
export function useRoomBlocks(roomId: string | null) {
  return useQuery({
    queryKey: ['room-blocks', roomId ?? ''],
    queryFn: () =>
      apiClient
        .get<{ data: RoomBlockResponse[] }>(`/room-blocks?room_id=${roomId}`)
        .then((r) => r.data),
    enabled: !!roomId,
  });
}

export function useCreateRoomBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRoomBlockRequest) =>
      apiClient.post<{ data: RoomBlockResponse }>('/room-blocks', body).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['room-blocks'] }),
  });
}

export function useDeleteRoomBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/room-blocks/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['room-blocks'] }),
  });
}
