import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@pms/ui';
import type {
  BookingResponse,
  CreateBookingRequest,
  GuestResponse,
  InvoiceResponse,
  OffsetPageInfo,
  UpdateBookingRequest,
} from '@pms/shared-types';
import { ApiClientError, apiClient } from '@/lib/api-client';

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

// ── Task 1.2 · chi tiết booking + vòng đời ─────────────────────────────────────

/**
 * Chi tiết 1 booking (task 1.2): GET /bookings/:id. Key `['bookings', id]` để SSE
 * `booking.*` (use-events.ts L16 invalidate prefix `['bookings']`) tick realtime.
 * LƯU Ý: getById KHÔNG embed guest (khác list()) → card khách phải `useGuest` riêng.
 */
export function useBooking(id: string) {
  return useQuery({
    queryKey: ['bookings', id],
    queryFn: () => apiClient.get<{ data: BookingResponse }>(`/bookings/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

/** Hoá đơn của 1 booking (task 1.2): GET /invoices?booking_id=<id> → BE listByBooking
 * (invoices.controller L22-23) trả mảng KHÔNG phân trang. Key `['invoices','booking',id]`. */
export function useInvoicesByBooking(bookingId: string) {
  return useQuery({
    queryKey: ['invoices', 'booking', bookingId],
    queryFn: () =>
      apiClient.get<{ data: InvoiceResponse[] }>(`/invoices?booking_id=${bookingId}`).then((r) => r.data),
    enabled: !!bookingId,
  });
}

/** 1 khách theo id (task 1.2, card khách): GET /guests/:id. `enabled=!!guestId` vì
 * booking.guest_id có thể null (khách lẻ). Số giấy tờ đã mask BE (id_document_masked). */
export function useGuest(guestId: string) {
  return useQuery({
    queryKey: ['guests', guestId],
    queryFn: () => apiClient.get<{ data: GuestResponse }>(`/guests/${guestId}`).then((r) => r.data),
    enabled: !!guestId,
  });
}

/**
 * 4 chuyển-trạng-thái vòng đời (task 1.2): confirm/cancel/checkIn/checkOut — đều là
 * POST không optimistic-lock (KHÔNG gửi If-Match; đúng domain rule cho lifecycle).
 * confirm dùng `force:false` (đường cọc HOLD→PENDING) — KHÔNG force để tránh 403
 * OWNER-only (bookings.service L599/604 target=force?CONFIRMED:PENDING).
 * onSettled cả 4 invalidate ['bookings']+['occupancy']+['invoices'] (check-out sinh
 * STAY invoice → refresh card hoá đơn).
 */
export function useBookingActions() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['bookings'] });
    void qc.invalidateQueries({ queryKey: ['occupancy'] });
    void qc.invalidateQueries({ queryKey: ['invoices'] });
  };

  const confirm = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiClient.post<{ data: BookingResponse }>(`/bookings/${id}/confirm`, { force: false }).then((r) => r.data),
    onSettled: invalidate,
  });
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.post<{ data: BookingResponse }>(`/bookings/${id}/cancel`, { reason }).then((r) => r.data),
    onSettled: invalidate,
  });
  const checkIn = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiClient.post<{ data: BookingResponse }>(`/bookings/${id}/check-in`).then((r) => r.data),
    onSettled: invalidate,
  });
  const checkOut = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiClient.post<{ data: BookingResponse }>(`/bookings/${id}/check-out`).then((r) => r.data),
    onSettled: invalidate,
  });

  return { confirm, cancel, checkIn, checkOut };
}

/**
 * Sửa thông tin booking (task 1.2): PATCH /bookings/:id với header If-Match=version
 * (optimistic lock — if-match.ts). Component xử lý ApiClientError.status: 428
 * IF_MATCH_REQUIRED (quên header) / 409 VERSION_CONFLICT (bookings.service L541 —
 * stale) → refetch ['bookings', id] rồi báo. onSettled invalidate ['bookings'].
 */
export function useUpdateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version, body }: { id: string; version: number; body: UpdateBookingRequest }) =>
      apiClient
        .patch<{ data: BookingResponse }>(`/bookings/${id}`, body, {
          headers: { 'If-Match': String(version) },
        })
        .then((r) => r.data),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['bookings'] }),
  });
}

/** toast lỗi chung theo mã BE: BOOKING_OVERLAP (409) → "phòng/ngày bận"; else chung. */
function toastOverlapOr(err: unknown, generic: string): void {
  const overlap = err instanceof ApiClientError && err.body?.code === 'BOOKING_OVERLAP';
  toast.error(overlap ? 'Phòng/khoảng ngày đã bận' : generic);
}

/**
 * Đổi phòng từ trang chi tiết (task 1.2): POST /bookings/:id/switch-resource. TÁI DÙNG
 * logic use-calendar.ts:37 (cùng endpoint + payload {new_resource_id, reason} + error
 * map) NHƯNG key theo booking (page không có occupancy cache → KHÔNG optimistic, chỉ
 * invalidate). Giữ payload đồng bộ use-calendar.ts:37 để không phân kỳ.
 */
export function useSwitchBookingResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, new_resource_id, reason }: { id: string; new_resource_id: string; reason: string }) =>
      apiClient
        .post<{ data: BookingResponse }>(`/bookings/${id}/switch-resource`, { new_resource_id, reason })
        .then((r) => r.data),
    onError: (err) => toastOverlapOr(err, 'Đổi phòng thất bại'),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      void qc.invalidateQueries({ queryKey: ['occupancy'] });
    },
  });
}

/**
 * Đổi lịch từ trang chi tiết (task 1.2): POST /bookings/:id/reschedule. TÁI DÙNG logic
 * use-calendar.ts:86 (cùng endpoint + payload {check_in, check_out, reason} + error map)
 * NHƯNG key theo booking (không optimistic — page không có occupancy cache). Giữ payload
 * đồng bộ use-calendar.ts:86. BE chặn CHECKED_IN/terminal (RescheduleBookingRequestSchema
 * doc booking.ts L80) → nút phải ẩn đúng trạng thái để tránh lỗi.
 */
export function useRescheduleBookingDetail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      check_in,
      check_out,
      reason,
    }: {
      id: string;
      check_in: string;
      check_out: string;
      reason: string;
    }) =>
      apiClient
        .post<{ data: BookingResponse }>(`/bookings/${id}/reschedule`, { check_in, check_out, reason })
        .then((r) => r.data),
    onError: (err) => toastOverlapOr(err, 'Đổi lịch thất bại'),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      void qc.invalidateQueries({ queryKey: ['occupancy'] });
    },
  });
}
