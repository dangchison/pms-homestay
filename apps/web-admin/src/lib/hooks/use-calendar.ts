import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@pms/ui';
import type { CalendarOccupancyResponse } from '@pms/shared-types';
import { ApiClientError, apiClient } from '@/lib/api-client';

type OccKey = readonly ['occupancy', string, string, string];

/**
 * Data-hook calendar (task 6.2, tách khỏi component — docs/ui/00 §4.5). Đọc
 * GET /occupancy theo property + khoảng [from,to). `keepPreviousData` để nav khoảng
 * mượt (không nháy trắng). SSE (`useEvents`) invalidate prefix `['occupancy']`.
 */
export function useCalendar(propertyId: string | null, fromISO: string, toISO: string) {
  return useQuery({
    queryKey: ['occupancy', propertyId ?? '', fromISO, toISO] as OccKey,
    queryFn: () =>
      apiClient
        .get<{ data: CalendarOccupancyResponse }>(
          `/occupancy?property_id=${propertyId}&from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`,
        )
        .then((r) => r.data),
    enabled: !!propertyId,
    placeholderData: keepPreviousData,
  });
}

interface SwitchVars {
  bookingId: string;
  newResourceId: string;
}

/**
 * Đổi phòng bằng kéo-thả (spec #C1): POST /bookings/:id/switch-resource. Optimistic
 * (chuyển bar sang resource mới ngay) + revert khi lỗi. 409 BOOKING_OVERLAP →
 * toast "phòng đã bận". SSE/onSettled refetch để đồng bộ buffer/occupancy thật.
 */
export function useSwitchResource(queryKey: OccKey) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, newResourceId }: SwitchVars) =>
      apiClient.post(`/bookings/${bookingId}/switch-resource`, {
        new_resource_id: newResourceId,
        reason: 'Đổi phòng trên lịch',
      }),
    onMutate: async ({ bookingId, newResourceId }) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<CalendarOccupancyResponse>(queryKey);
      if (prev) {
        const target = prev.resources.find((r) => r.id === newResourceId);
        qc.setQueryData<CalendarOccupancyResponse>(queryKey, {
          ...prev,
          bookings: prev.bookings.map((b) =>
            b.id === bookingId
              ? { ...b, resource_id: newResourceId, is_whole: target?.type === 'WHOLE' }
              : b,
          ),
        });
      }
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
      const overlap = err instanceof ApiClientError && err.body?.code === 'BOOKING_OVERLAP';
      toast.error(
        overlap ? 'Phòng đích đã có khách/đặt trong khoảng này' : 'Đổi phòng thất bại — đã hoàn tác',
      );
    },
    onSuccess: () => toast.success('Đã đổi phòng'),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['occupancy'] }),
  });
}
