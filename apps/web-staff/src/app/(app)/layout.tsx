import Link from 'next/link';
import { BedDouble, CalendarCheck, Sparkles, User } from 'lucide-react';

const TABS = [
  { href: '/today', label: 'Hôm nay', icon: CalendarCheck },
  { href: '/cleaning', label: 'Dọn phòng', icon: Sparkles },
  { href: '/rooms', label: 'Phòng', icon: BedDouble },
  { href: '/profile', label: 'Cá nhân', icon: User },
] as const;

/**
 * Layout app nhân viên (ui/02): bottom navigation cho mobile.
 * TODO(task 6.6): OfflineBanner (read-cache, mutation cần mạng).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1 p-4 pb-20">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 border-t bg-card">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {TABS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-center gap-1 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <Icon className="size-5" />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
