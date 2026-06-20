import { useMutation, useQuery } from '@tanstack/react-query';
import type { BookingResponse, CreateBookingRequest, OffsetPageInfo } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/** Đếm tổng booking của cơ sở — onboarding D1 ("đã nhận booking chưa"). */
export function useBookingsCount(propertyId: string | null) {
  return useQuery({
    queryKey: ['bookings', 'count', propertyId ?? ''],
    queryFn: () =>
      apiClient
        .get<{ data: BookingResponse[]; page_info: OffsetPageInfo }>(
          `/bookings?property_id=${propertyId!}&page_size=1`,
        )
        .then((r) => r.page_info.total_items),
    enabled: !!propertyId,
  });
}

/**
 * Tạo booking (task 6.3, flow F1 bước 4): POST /bookings + **Idempotency-Key**
 * (chống tạo trùng khi double-submit / retry mạng). Component xử lý 409
 * PRICE_CHANGED (re-quote) / BOOKING_OVERLAP (dialog) từ ApiClientError.
 */
export function useCreateBooking() {
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: CreateBookingRequest; idempotencyKey: string }) =>
      apiClient
        .post<{ data: BookingResponse }>('/bookings', body, {
          headers: { 'Idempotency-Key': idempotencyKey },
        })
        .then((r) => r.data),
  });
}
