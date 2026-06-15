'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@pms/ui';
import { BedDouble, CalendarCheck, Sparkles, User } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';

/**
 * Bottom tab bar (docs/ui/02): Hôm nay · Dọn phòng · Phòng · Cá nhân. Nút chạm ≥44px.
 * Tab theo role — HOUSEKEEPER chỉ thấy Phòng/Dọn phòng/Cá nhân (không có "Hôm nay").
 */
const TABS = [
  { href: '/today', label: 'Hôm nay', icon: CalendarCheck },
  { href: '/cleaning', label: 'Dọn phòng', icon: Sparkles },
  { href: '/rooms', label: 'Phòng', icon: BedDouble },
  { href: '/profile', label: 'Cá nhân', icon: User },
] as const;

export function BottomTabs() {
  const pathname = usePathname();
  const role = useAuthStore((s) => s.user?.role);
  // HOUSEKEEPER không thấy "Hôm nay" (chỉ lễ tân/quản lý có lịch đến/đi).
  const tabs = TABS.filter((t) => !(role === 'HOUSEKEEPER' && t.href === '/today'));

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t bg-card pb-[env(safe-area-inset-bottom)]">
      <div className={cn('mx-auto grid max-w-md', tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3')}>
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex min-h-14 flex-col items-center justify-center gap-1 text-xs transition-colors',
                active ? 'font-medium text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className={cn('size-5', active && 'fill-primary/15')} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
