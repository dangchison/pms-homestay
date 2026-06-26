import * as React from 'react';
import Link from 'next/link';
import { cn } from '@pms/ui';

/**
 * Khung trang chuẩn — nhịp spacing + header thống nhất toàn web-admin
 * (theo trang Tổng quan: grid gap-6, title text-2xl). Padding do `<main>` của
 * (dashboard)/layout đảm nhiệm (`p-4 md:p-6`) — page KHÔNG tự thêm p-4.
 */
export function PageContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('grid gap-6', className)}>{children}</div>;
}

export interface Crumb {
  label: string;
  /** Có href → là link điều hướng; bỏ trống ở mục cuối (trang hiện tại). */
  href?: string;
}

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Chỉ dùng cho trang có phân cấp (settings sub-page, trang chi tiết). */
  breadcrumb?: Crumb[];
  /** Vùng bên phải: filter / CTA. */
  action?: React.ReactNode;
}

/** Header trang thống nhất (title + description + breadcrumb + action). */
export function PageHeader({ title, description, breadcrumb, action }: PageHeaderProps) {
  return (
    <div className="grid gap-2">
      {breadcrumb && breadcrumb.length > 0 && <Breadcrumb items={breadcrumb} />}
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <React.Fragment key={`${item.label}-${i}`}>
            {item.href && !last ? (
              <Link href={item.href} className="transition-colors hover:text-foreground">
                {item.label}
              </Link>
            ) : (
              <span
                className={cn(last && 'font-medium text-foreground')}
                aria-current={last ? 'page' : undefined}
              >
                {item.label}
              </span>
            )}
            {!last && <span className="text-muted-foreground/50">/</span>}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
