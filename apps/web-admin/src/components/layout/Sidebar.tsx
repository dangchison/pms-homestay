'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@pms/ui';
import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  BedDouble,
  Building2,
  CalendarDays,
  Coins,
  Home,
  LayoutDashboard,
  type LucideIcon,
  ReceiptText,
  Settings,
  Share2,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';
import { type UserRole } from '@pms/shared-types';
import { useAuthStore } from '@/stores/auth.store';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Nếu có: chỉ hiện khi role hiện tại thuộc danh sách (RBAC menu). Không có → luôn hiện. */
  roles?: UserRole[];
}
interface NavSection {
  label: string | null;
  items: NavItem[];
}

/** Menu theo role matrix docs/ui/00 §5 — mục có `roles` lọc theo role hiện tại. */
const SECTIONS: NavSection[] = [
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
      { href: '/invoices', label: 'Hoá đơn', icon: ReceiptText },
      { href: '/payments', label: 'Thanh toán', icon: Wallet },
      { href: '/payments/unmatched', label: 'Đối soát', icon: ArrowLeftRight },
      { href: '/reports', label: 'Báo cáo', icon: BarChart3 },
      // Sổ quỹ ca: chỉ role report.financial (OWNER/MANAGER/ACCOUNTANT) — STAFF/HOUSEKEEPER ẩn.
      { href: '/shifts', label: 'Sổ quỹ ca', icon: Banknote, roles: ['OWNER', 'MANAGER', 'ACCOUNTANT'] },
      { href: '/expenses', label: 'Chi phí', icon: Coins, roles: ['OWNER', 'MANAGER', 'ACCOUNTANT'] },
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
];

// href đang active = href dài nhất là tiền tố của pathname (đúng cả /payments vs
// /payments/unmatched — chọn cái cụ thể hơn). '/' chỉ active đúng tại '/'.
const ALL_HREFS = SECTIONS.flatMap((s) => s.items.map((i) => i.href));
function activeHrefFor(pathname: string): string {
  if (pathname === '/') return '/';
  return (
    ALL_HREFS.filter((h) => h !== '/' && (pathname === h || pathname.startsWith(`${h}/`))).sort(
      (a, b) => b.length - a.length,
    )[0] ?? ''
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const activeHref = activeHrefFor(pathname);
  const role = useAuthStore((s) => s.user?.role);

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
        {SECTIONS.map((section) => {
          // Lọc mục có `roles`: chỉ giữ khi role hiện tại thuộc danh sách. Mục không có
          // `roles` luôn hiện. Section rỗng sau lọc → bỏ (không render tiêu đề trống).
          const items = section.items.filter(
            (item) => !item.roles || (role != null && item.roles.includes(role)),
          );
          if (items.length === 0) return null;
          return (
            <div key={section.label ?? 'main'}>
              {section.label && (
                <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {section.label}
                </div>
              )}
              <div className="grid gap-0.5">
                {items.map(({ href, label, icon: Icon }) => {
                  const active = href === activeHref;
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
          );
        })}
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
