import { useQuery } from '@tanstack/react-query';
import type { RoomBoardResponse } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/**
 * Bảng phòng (GET /rooms/board, task 6.6) — Dashboard D1 dùng để đếm phòng cần
 * dọn. Key `['rooms','board']` → SSE room.* invalidate (`['rooms']`) tự refetch.
 */
export function useRoomsBoard(propertyId: string | null) {
  return useQuery({
    queryKey: ['rooms', 'board', propertyId ?? ''],
    queryFn: () =>
      apiClient.get<{ data: RoomBoardResponse }>(`/rooms/board?property_id=${propertyId!}`).then((r) => r.data),
    enabled: !!propertyId,
  });
}
