'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@pms/ui';
import type { UserRole } from '@pms/shared-types';
import { useAuthStore } from '@/stores/auth.store';

const ALL: UserRole[] = ['OWNER', 'MANAGER', 'ACCOUNTANT', 'STAFF', 'HOUSEKEEPER'];

/** Tab điều hướng Settings (S1–S6), lọc theo role (khớp quyền BE → tránh 403). */
const TABS: { href: string; label: string; roles: UserRole[] }[] = [
  { href: '/settings', label: 'Cơ sở', roles: ALL }, // tenant.read; sửa chỉ OWNER
  { href: '/settings/users', label: 'Người dùng', roles: ['OWNER'] },
  { href: '/settings/billing', label: 'Gói & Thanh toán', roles: ['OWNER'] },
  { href: '/settings/security', label: 'Bảo mật', roles: ALL },
  { href: '/settings/audit-logs', label: 'Nhật ký', roles: ['OWNER', 'ACCOUNTANT'] },
  { href: '/settings/compliance', label: 'Tuân thủ', roles: ['OWNER', 'MANAGER'] },
];

export function SettingsNav() {
  const pathname = usePathname();
  const role = useAuthStore((s) => s.user?.role);
  const tabs = TABS.filter((t) => !role || t.roles.includes(role));

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const active = t.href === '/settings' ? pathname === '/settings' : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              'shrink-0 px-3 py-2 text-sm transition-colors',
              active
                ? 'border-b-2 border-primary font-medium text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
