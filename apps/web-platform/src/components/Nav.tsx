'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button, cn } from '@pms/ui';
import { useAuthStore } from '@/stores/auth.store';

const LINKS = [
  { href: '/plans', label: 'Gói thuê bao' },
  { href: '/tenants', label: 'Tenant' },
  { href: '/payments', label: 'Thanh toán' },
] as const;

export function Nav() {
  const pathname = usePathname();
  const admin = useAuthStore((s) => s.admin);
  const clear = useAuthStore((s) => s.clear);

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 md:px-6">
        <span className="font-semibold">Quản trị nền tảng</span>
        <nav className="flex flex-1 items-center gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                pathname.startsWith(l.href)
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        {admin && <span className="hidden text-sm text-muted-foreground sm:inline">{admin.email}</span>}
        <Button size="sm" variant="outline" onClick={clear}>
          Đăng xuất
        </Button>
      </div>
    </header>
  );
}
