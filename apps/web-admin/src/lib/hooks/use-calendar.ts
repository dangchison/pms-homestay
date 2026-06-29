import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@pms/ui';
import type { CalendarBooking, CalendarOccupancyResponse } from '@pms/shared-types';
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

interface RescheduleVars {
  booking: CalendarBooking;
  checkIn: string; // ISO UTC
  checkOut: string; // ISO UTC
}

const shiftIso = (iso: string, ms: number): string => new Date(new Date(iso).getTime() + ms).toISOString();

/**
 * Đổi lịch bằng kéo MÉP bar (A3 F3 — phần 3): POST /bookings/:id/reschedule. Optimistic
 * (đổi check_in/out + dịch occupancy theo cùng delta) + revert khi lỗi. 409 BOOKING_OVERLAP
 * → toast "ngày mới đã bận". onSettled refetch để đồng bộ buffer/giá thật (BE tính lại total).
 */
export function useRescheduleBooking(queryKey: OccKey) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ booking, checkIn, checkOut }: RescheduleVars) =>
      apiClient.post(`/bookings/${booking.id}/reschedule`, {
        check_in: checkIn,
        check_out: checkOut,
        reason: 'Đổi lịch trên calendar',
      }),
    onMutate: async ({ booking, checkIn, checkOut }) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<CalendarOccupancyResponse>(queryKey);
      if (prev) {
        const dCi = new Date(checkIn).getTime() - new Date(booking.check_in).getTime();
        const dCo = new Date(checkOut).getTime() - new Date(booking.check_out).getTime();
        qc.setQueryData<CalendarOccupancyResponse>(queryKey, {
          ...prev,
          bookings: prev.bookings.map((b) =>
            b.id === booking.id
              ? {
                  ...b,
                  check_in: checkIn,
                  check_out: checkOut,
                  occupancy_start: shiftIso(b.occupancy_start, dCi),
                  occupancy_end: shiftIso(b.occupancy_end, dCo),
                }
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
        overlap ? 'Khoảng ngày mới đã có khách/đặt' : 'Đổi lịch thất bại — đã hoàn tác',
      );
    },
    onSuccess: () => toast.success('Đã đổi lịch'),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['occupancy'] }),
  });
}
