'use client';

import { Badge } from '@pms/ui';
import { useGuestPlatformSummary } from '@/lib/hooks/use-guest-platform-summary';

/**
 * Task 2.9 (docs/19 Đợt 2) — chip tín hiệu danh tính cross-tenant của khách, dùng chung
 * ở GuestPicker (nhánh đã-chọn) và GuestDetailDialog (hàng tiêu đề).
 *
 * Ẩn (render null) khi: chưa có data / đang tải / lỗi (data undefined), hoặc khách CHƯA gắn
 * person (`linked === false` — không lộ việc khách chưa có danh tính), hoặc cả hai cờ đều tắt.
 *
 * "Blacklist nơi khác" là tín hiệu blacklist ở TENANT KHÁC (cross-tenant) — KHÁC hẳn badge
 * "Blacklist" nội bộ (`guest.is_blacklisted`) mà nơi gọi tự render. Trả về fragment để mỗi
 * badge là con trực tiếp của flex container bao ngoài (kế thừa gap của nơi gọi).
 */
export function GuestPlatformChips({ guestId }: { guestId: string }) {
  const { data } = useGuestPlatformSummary(guestId);

  if (!data || !data.linked) return null;
  if (!data.is_returning_guest && !data.blacklisted_elsewhere) return null;

  return (
    <>
      {data.is_returning_guest && <Badge variant="secondary">Khách quen</Badge>}
      {data.blacklisted_elsewhere && <Badge variant="destructive">Blacklist nơi khác</Badge>}
    </>
  );
}
