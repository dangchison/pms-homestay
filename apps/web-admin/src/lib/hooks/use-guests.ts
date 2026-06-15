import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { CreateGuestRequest, GuestResponse } from '@pms/shared-types';
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
