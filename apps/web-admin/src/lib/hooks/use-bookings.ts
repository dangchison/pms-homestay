import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { BookingResponse, CreateBookingRequest, OffsetPageInfo } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

export interface BookingFilters {
  status?: string;
  /** ISO datetime (BE dùng z.iso.datetime()). Lọc theo check_in ≥ from. */
  from?: string;
  /** ISO datetime. Lọc theo check_in ≤ to. */
  to?: string;
  page?: number;
}

/**
 * Task 1.1 — danh sách booking theo cơ sở + filter (mẫu `useInvoices`). Key prefix
 * `['bookings']` được `useEvents` (SSE) invalidate khi có `booking.*` (use-events.ts
 * L16) → realtime tick sẵn, KHÔNG cần subscribe mới. `from`/`to` gửi ISO datetime.
 */
export function useBookingsList(propertyId: string | null, filters: BookingFilters) {
  return useQuery({
    queryKey: ['bookings', 'list', propertyId ?? '', filters],
    queryFn: () => {
      const p = new URLSearchParams({ property_id: propertyId!, page: String(filters.page ?? 1) });
      if (filters.status) p.set('status', filters.status);
      if (filters.from) p.set('from', filters.from);
      if (filters.to) p.set('to', filters.to);
      return apiClient.get<{ data: BookingResponse[]; page_info: OffsetPageInfo }>(
        `/bookings?${p.toString()}`,
      );
    },
    enabled: !!propertyId,
    placeholderData: keepPreviousData,
  });
}

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
