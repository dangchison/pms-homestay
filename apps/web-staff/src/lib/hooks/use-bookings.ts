'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookingResponse, ConfirmBookingRequest } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

export function useBooking(id: string) {
  return useQuery({
    queryKey: ['bookings', id],
    queryFn: () => apiClient.get<{ data: BookingResponse }>(`/bookings/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

/** OWNER xác nhận thẳng (force) — bỏ qua bước cọc (PENDING/HOLD → CONFIRMED). */
export function useConfirmBooking(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ConfirmBookingRequest) =>
      apiClient.post<{ data: BookingResponse }>(`/bookings/${id}/confirm`, body).then((r) => r.data),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['bookings', id] });
      void qc.invalidateQueries({ queryKey: ['today'] });
    },
  });
}

export function useCheckIn(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post<{ data: BookingResponse }>(`/bookings/${id}/check-in`).then((r) => r.data),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['bookings', id] });
      void qc.invalidateQueries({ queryKey: ['today'] });
      void qc.invalidateQueries({ queryKey: ['rooms-board'] });
    },
  });
}

export function useCheckOut(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post<{ data: BookingResponse }>(`/bookings/${id}/check-out`).then((r) => r.data),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['bookings', id] });
      void qc.invalidateQueries({ queryKey: ['today'] });
      void qc.invalidateQueries({ queryKey: ['rooms-board'] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}
