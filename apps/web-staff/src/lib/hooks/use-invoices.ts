'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatePaymentRequest, InvoiceResponse, PaymentResponse } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/** T4 — folio: mọi invoice của booking (DEPOSIT/STAY/ADJUSTMENT). Key `['invoices', booking_id]`. */
export function useInvoicesByBooking(bookingId: string | null) {
  return useQuery({
    queryKey: ['invoices', 'booking', bookingId ?? ''],
    queryFn: () =>
      apiClient.get<{ data: InvoiceResponse[] }>(`/invoices?booking_id=${bookingId!}`).then((r) => r.data),
    enabled: !!bookingId,
  });
}

/** Ghi nhận thanh toán tiền mặt/chuyển khoản (SUCCEEDED ngay). Idempotency-Key mỗi lần gửi. */
export function useRecordPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: CreatePaymentRequest; idempotencyKey: string }) =>
      apiClient
        .post<{ data: PaymentResponse }>('/payments', body, { headers: { 'Idempotency-Key': idempotencyKey } })
        .then((r) => r.data),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      // Thu cọc → booking PENDING tự CONFIRMED → cập nhật booking + bảng hôm nay.
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      void qc.invalidateQueries({ queryKey: ['today'] });
    },
  });
}
