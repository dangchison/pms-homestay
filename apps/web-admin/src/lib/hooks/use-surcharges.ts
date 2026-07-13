import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookingSurchargeResponse, CreateBookingSurchargeRequest } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/**
 * Phụ thu lưu trú của 1 booking (task 2.7, docs/19 §3 Đợt 2 — B5 docs/09 §4.3).
 * queryKey ['bookings', bookingId, 'surcharges'] nằm DƯỚI cây 'bookings' nhưng KHÔNG
 * trùng detail ['bookings', id] (3 phần tử → không bị invalidate lẫn nhau). Mọi mutation
 * invalidate ĐÚNG key đó để danh sách tự refetch. BE gate `booking.update` (add/remove),
 * `booking.read` (list) — demo OWNER có đủ.
 */
export function useSurcharges(bookingId: string) {
  return useQuery({
    queryKey: ['bookings', bookingId, 'surcharges'],
    queryFn: () =>
      apiClient
        .get<{ data: BookingSurchargeResponse[] }>(`/bookings/${bookingId}/surcharges`)
        .then((r) => r.data),
  });
}

function useInvalidateSurcharges(bookingId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['bookings', bookingId, 'surcharges'] });
  };
}

export function useAddSurcharge(bookingId: string) {
  const invalidate = useInvalidateSurcharges(bookingId);
  return useMutation({
    mutationFn: (body: CreateBookingSurchargeRequest) =>
      apiClient
        .post<{ data: BookingSurchargeResponse }>(`/bookings/${bookingId}/surcharges`, body)
        .then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useRemoveSurcharge(bookingId: string) {
  const invalidate = useInvalidateSurcharges(bookingId);
  return useMutation({
    mutationFn: (surchargeId: string) =>
      apiClient.delete(`/bookings/${bookingId}/surcharges/${surchargeId}`),
    onSuccess: invalidate,
  });
}
