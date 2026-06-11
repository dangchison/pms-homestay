'use client';

import { Button, toast } from '@pms/ui';
import { Bell, Building2, ChevronsUpDown, Plus } from 'lucide-react';

/**
 * TopBar: PropertySwitcher + realtime status + notifications (docs/13 §3).
 * TODO(task 6.1): PropertySwitcher đọc /properties; chấm SSE theo useEvents.
 */
export function TopBar() {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 shadow-xs backdrop-blur md:px-6">
      <button
        type="button"
        onClick={() => toast.info('PropertySwitcher nối dữ liệu thật ở task 6.1')}
        className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm transition-colors hover:bg-accent"
      >
        <Building2 className="size-4 text-primary" />
        <span className="font-medium">Demo Homestay Đà Nẵng</span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground" />
      </button>

      <div className="flex items-center gap-2">
        <span className="mr-1 hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-success" />
          </span>
          Realtime
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Thông báo"
          onClick={() => toast.info('Notifications ở task 4.4')}
        >
          <Bell className="size-4.5" />
        </Button>
        <Button onClick={() => toast.info('Đặt phòng nhanh mở từ calendar — task 6.2/6.3')}>
          <Plus className="size-4" />
          Đặt phòng
        </Button>
      </div>
    </header>
  );
}
