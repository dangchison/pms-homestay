import * as React from 'react';
import { cn } from '../lib/cn';

export interface SectionHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** nút/điều khiển bên phải (filter, CTA…) */
  action?: React.ReactNode;
}

/** Header nhóm — nhịp tiêu đề thống nhất toàn app (docs/ui §2). */
export function SectionHeader({
  title,
  description,
  action,
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <div className={cn('flex items-end justify-between gap-3', className)} {...props}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
