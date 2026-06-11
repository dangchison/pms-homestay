import * as React from 'react';
import { cn } from '../lib/cn';

/** Loading skeleton — mọi trang bắt buộc có trạng thái loading (docs/ui §2.6). */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

export { Skeleton };
