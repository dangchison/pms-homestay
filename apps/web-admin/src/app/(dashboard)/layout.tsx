import Link from 'next/link';
import {
  BarChart3,
  BedDouble,
  CalendarDays,
  CreditCard,
  LayoutDashboard,
  Settings,
  Users,
} from 'lucide-react';

const NAV = [
  { href: '/', label: 'Tổng quan', icon: LayoutDashboard },
  { href: '/calendar', label: 'Lịch phòng', icon: CalendarDays },
  { href: '/bookings', label: 'Đặt phòng', icon: BedDouble },
  { href: '/guests', label: 'Khách', icon: Users },
  { href: '/invoices', label: 'Hoá đơn', icon: CreditCard },
  { href: '/reports', label: 'Báo cáo', icon: BarChart3 },
  { href: '/settings', label: 'Cài đặt', icon: Settings },
] as const;

/**
 * Layout dashboard (ui/01): sidebar + PropertySwitcher + useEvents (SSE).
 * TODO(task 6.1): PropertySwitcher, useEvents hook, auth redirect.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r bg-card md:flex md:flex-col">
        <div className="flex h-14 items-center border-b px-4 font-semibold">PMS Homestay</div>
        <nav className="grid gap-1 p-2 text-sm">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-4">
          <div className="text-sm text-muted-foreground">
            {/* TODO(task 6.1): PropertySwitcher */}
            Demo Homestay Đà Nẵng
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
