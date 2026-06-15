import { useMutation } from '@tanstack/react-query';
import type { BookingResponse, CreateBookingRequest } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

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
