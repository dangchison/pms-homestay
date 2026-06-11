'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@pms/ui';
import {
  BarChart3,
  BedDouble,
  Building2,
  CalendarDays,
  Home,
  LayoutDashboard,
  ReceiptText,
  Settings,
  Share2,
  Sparkles,
  Users,
} from 'lucide-react';

/** Menu theo role matrix docs/ui/00 §5 — render đủ cho OWNER ở scaffold. */
const SECTIONS = [
  {
    label: null,
    items: [
      { href: '/', label: 'Tổng quan', icon: LayoutDashboard },
      { href: '/calendar', label: 'Lịch phòng', icon: CalendarDays },
    ],
  },
  {
    label: 'Vận hành',
    items: [
      { href: '/bookings', label: 'Đặt phòng', icon: BedDouble },
      { href: '/guests', label: 'Khách', icon: Users },
      { href: '/cleaning', label: 'Dọn phòng', icon: Sparkles },
    ],
  },
  {
    label: 'Tài chính',
    items: [
      { href: '/invoices', label: 'Hoá đơn & Thanh toán', icon: ReceiptText },
      { href: '/reports', label: 'Báo cáo', icon: BarChart3 },
    ],
  },
  {
    label: 'Cấu hình',
    items: [
      { href: '/properties', label: 'Cơ sở & Phòng', icon: Building2 },
      { href: '/channels', label: 'Kênh OTA', icon: Share2 },
      { href: '/settings', label: 'Cài đặt', icon: Settings },
    ],
  },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex h-16 items-center gap-2.5 border-b border-border px-5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Home className="size-4.5" />
        </span>
        <div className="leading-tight">
          <div className="font-semibold tracking-tight">PMS Homestay</div>
          <div className="text-[11px] text-muted-foreground">Quản trị</div>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {SECTIONS.map((section) => (
          <div key={section.label ?? 'main'}>
            {section.label && (
              <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {section.label}
              </div>
            )}
            <div className="grid gap-0.5">
              {section.items.map(({ href, label, icon: Icon }) => {
                const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-primary-muted font-medium text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
          <span className="flex size-8 items-center justify-center rounded-full bg-chip-brand-soft text-xs font-semibold text-chip-brand">
            CD
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-medium">Chủ Demo</div>
            <div className="truncate text-[11px] text-muted-foreground">OWNER</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
