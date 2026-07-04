import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateGuestRequest,
  GuestIdDocumentResponse,
  GuestResponse,
  OffsetPageInfo,
} from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/** Tìm khách cho GuestPicker (task 6.3): trgm tên / SĐT / 4 số cuối giấy tờ (G1). */
export function useGuestsSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: ['guests', 'search', term],
    queryFn: () =>
      apiClient
        .get<{ data: GuestResponse[] }>(`/guests?q=${encodeURIComponent(term)}&page_size=8`)
        .then((r) => r.data),
    enabled: term.length >= 2,
    placeholderData: keepPreviousData,
  });
}

/** Tạo khách inline trong picker (POST /guests → guest mới). */
export function useCreateGuest() {
  return useMutation({
    mutationFn: (body: CreateGuestRequest) =>
      apiClient.post<{ data: GuestResponse }>('/guests', body).then((r) => r.data),
  });
}

/**
 * Task 1.4 — danh sách khách cho trang /guests (mẫu `useBookingsList`). Tìm kiếm `q`
 * (trgm tên / SĐT / 4 số cuối giấy tờ) CHỈ gửi khi có ký tự; phân trang offset 20/trang.
 * Số giấy tờ đã mask sẵn BE (`id_document_masked`) — list KHÔNG bao giờ trả plaintext.
 */
export function useGuestsList(q: string, page: number) {
  const term = q.trim();
  return useQuery({
    queryKey: ['guests', 'list', term, page],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), page_size: '20' });
      // URLSearchParams.toString() tự percent-encode — KHÔNG encodeURIComponent (tránh double-encode).
      if (term) p.set('q', term);
      return apiClient.get<{ data: GuestResponse[]; page_info: OffsetPageInfo }>(
        `/guests?${p.toString()}`,
      );
    },
    placeholderData: keepPreviousData,
  });
}

/**
 * Xem số giấy tờ ĐẦY ĐỦ (task 1.4): GET /guests/:id/id-document — decrypt + BE tự ghi
 * audit READ_PII (guest.pii.read). Dùng `useMutation` (fire-on-click) CHỨ KHÔNG `useQuery`:
 * mỗi lần xem PHẢI gọi lại endpoint để BE ghi audit, không được cache/tái dùng số đã giải mã.
 */
export function useGuestIdDocument() {
  return useMutation({
    mutationFn: (guestId: string) =>
      apiClient
        .get<{ data: GuestIdDocumentResponse }>(`/guests/${guestId}/id-document`)
        .then((r) => r.data),
  });
}

/**
 * Đưa khách vào blacklist (task 1.4): POST /guests/:id/blacklist với `reason` bắt buộc
 * (khớp BlacklistGuestRequestSchema min 1). Quyền booking.update. onSuccess invalidate
 * `['guests']` để list + chi tiết refresh badge/lý-do.
 */
export function useBlacklistGuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ guestId, reason }: { guestId: string; reason: string }) =>
      apiClient.post(`/guests/${guestId}/blacklist`, { reason }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['guests'] }),
  });
}

/** Gỡ blacklist (task 1.4): POST /guests/:id/unblacklist — KHÔNG body. Quyền booking.update. */
export function useUnblacklistGuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (guestId: string) => apiClient.post(`/guests/${guestId}/unblacklist`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['guests'] }),
  });
}
