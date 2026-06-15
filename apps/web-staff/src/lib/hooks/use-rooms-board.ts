'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HousekeepingStatus, RoomBoardResponse, RoomResponse } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/** T7 — room board. Key `['rooms-board']` → SSE room.* invalidate. */
export function useRoomBoard(propertyId: string | null) {
  return useQuery({
    queryKey: ['rooms-board', propertyId ?? ''],
    queryFn: () =>
      apiClient
        .get<{ data: RoomBoardResponse }>(`/rooms/board?property_id=${propertyId!}`)
        .then((r) => r.data),
    enabled: !!propertyId,
  });
}

/** Đổi nhanh trạng thái buồng phòng (PATCH /rooms/:id/housekeeping). */
export function useUpdateHousekeeping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, status }: { roomId: string; status: HousekeepingStatus }) =>
      apiClient
        .patch<{ data: RoomResponse }>(`/rooms/${roomId}/housekeeping`, { housekeeping_status: status })
        .then((r) => r.data),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['rooms-board'] }),
  });
}
