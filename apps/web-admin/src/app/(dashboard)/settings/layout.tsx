'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { PageContainer, PageHeader } from '@/components/layout/page';
import { SettingsNav } from '@/components/settings/SettingsNav';

// Nhãn trang con (khớp SettingsNav) → dùng cho title + breadcrumb.
const SUB_LABELS: Record<string, string> = {
  '/settings/users': 'Người dùng',
  '/settings/billing': 'Gói & Thanh toán',
  '/settings/security': 'Bảo mật',
  '/settings/audit-logs': 'Nhật ký',
  '/settings/compliance': 'Tuân thủ',
};

/** Khu Settings (task 6.7, ui/01 S1–S6): header thống nhất + tab điều hướng. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const subPath = Object.keys(SUB_LABELS).find((p) => pathname.startsWith(p));
  const subLabel = subPath ? SUB_LABELS[subPath] : undefined;

  return (
    <PageContainer>
      <PageHeader
        title={subLabel ?? 'Cài đặt'}
        breadcrumb={subLabel ? [{ label: 'Cài đặt', href: '/settings' }, { label: subLabel }] : undefined}
      />
      <SettingsNav />
      {children}
    </PageContainer>
  );
}
