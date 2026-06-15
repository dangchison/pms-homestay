'use client';

import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOfflineCache';

/**
 * ★ READ-CACHE ONLY (docs/13 §4, ui/02): khi rớt mạng hiện banner — dữ liệu đã
 * tải vẫn xem được (Workbox cache), nhưng mọi thao tác ghi bị khoá (nút disable).
 * Sticky trên cùng khu (app).
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div className="sticky top-0 z-20 flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-sm font-medium text-amber-950">
      <WifiOff className="size-4" />
      Đang offline — chỉ xem, không thao tác được
    </div>
  );
}
