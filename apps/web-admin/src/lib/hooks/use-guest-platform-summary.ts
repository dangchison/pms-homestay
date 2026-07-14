import { useQuery } from '@tanstack/react-query';
import type { GuestPlatformSummaryResponse } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/**
 * Task 2.9 (docs/19 Đợt 2) — tín hiệu danh tính TOÀN CỤC của 1 khách (tầng `persons`,
 * endpoint #58 `GET /guests/:id/platform-summary`). CHỈ nhận diện, KHÔNG lộ PII cross-tenant:
 * chủ hiện tại biết khách quen / bị blacklist ở nơi khác mà không thấy dữ liệu/booking/lý-do
 * của chủ khác.
 *
 * queryKey là con của prefix `['guests']` → `useBlacklistGuest`/`useUnblacklistGuest`
 * (invalidate `['guests']`) tự refetch chip: khi chủ hiện tại tự blacklist,
 * `blacklisted_elsewhere` = anywhere && !is_blacklisted → chip "Blacklist nơi khác" tự ẩn.
 */
export function useGuestPlatformSummary(guestId: string) {
  return useQuery({
    queryKey: ['guests', guestId, 'platform-summary'],
    queryFn: () =>
      apiClient
        .get<{ data: GuestPlatformSummaryResponse }>(`/guests/${guestId}/platform-summary`)
        .then((r) => r.data),
    enabled: !!guestId,
  });
}
