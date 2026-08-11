'use client';

import { useRouter } from 'next/navigation';
import { Button, cn } from '@pms/ui';
import { Globe, LogOut, Plus } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { logout } from '@/lib/auth';
import { useRealtimeStore } from '@/lib/hooks/use-events';
import { useAuthStore } from '@/stores/auth.store';
import { useLocaleStore } from '@/stores/locale.store';
import { usePropertyStore } from '@/stores/property.store';
import { NotificationBell } from './NotificationBell';
import { PropertySwitcher } from './PropertySwitcher';

/**
 * TopBar: PropertySwitcher + chấm realtime (SSE) + đổi ngôn ngữ + đăng xuất
 * (docs/13 §3). `useEvents` mount ở AuthGate; đây chỉ đọc trạng thái kết nối.
 */
export function TopBar() {
  const router = useRouter();
  const t = useT();
  const connected = useRealtimeStore((s) => s.connected);
  const { locale, setLocale } = useLocaleStore();
  const user = useAuthStore((s) => s.user);
  const propertyId = usePropertyStore((s) => s.selectedId);

  const onLogout = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 shadow-xs backdrop-blur md:px-6">
      <PropertySwitcher />

      <div className="flex items-center gap-2">
        <span className="mr-1 hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <span className="relative flex size-2">
            {connected && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
            )}
            <span className={cn('relative inline-flex size-2 rounded-full', connected ? 'bg-success' : 'bg-muted-foreground/40')} />
          </span>
          {connected ? t('topbar.realtime') : t('topbar.offline')}
        </span>

        <button
          type="button"
          onClick={() => setLocale(locale === 'vi' ? 'en' : 'vi')}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
          aria-label="Đổi ngôn ngữ / Switch language"
        >
          <Globe className="size-4" />
          {locale.toUpperCase()}
        </button>

        <NotificationBell />
        {/* Trước đây nút này chỉ bắn toast lộ mã task nội bộ, dù /bookings/new đã có
            form đặt phòng đầy đủ (báo giá sống, chọn khách). Form cần propertyId nên
            vô hiệu khi chưa chọn cơ sở, kèm lý do thay vì bấm rồi mới biết. */}
        <Button
          disabled={!propertyId}
          title={propertyId ? undefined : 'Chọn hoặc tạo một cơ sở trước khi đặt phòng'}
          onClick={() => router.push('/bookings/new')}
        >
          <Plus className="size-4" />
          {t('topbar.newBooking')}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('auth.logout')}
          title={user?.full_name ?? undefined}
          onClick={onLogout}
        >
          <LogOut className="size-4.5" />
        </Button>
      </div>
    </header>
  );
}
