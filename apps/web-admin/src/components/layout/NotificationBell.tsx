'use client';

import { useMemo } from 'react';
import { Bell } from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTrigger, cn, toast } from '@pms/ui';
import { ApiClientError } from '@/lib/api-client';
import { useT } from '@/lib/i18n';
import { useLocaleStore } from '@/stores/locale.store';
import {
  unreadCount,
  useMarkNotificationRead,
  useNotifications,
} from '@/lib/hooks/use-notifications';

/**
 * Chuông thông báo TopBar (task 2.1, docs/19 §3 Đợt 2): inbox IN_APP của CHÍNH user.
 * - Badge số chưa đọc là overlay tuyệt đối trong wrapper `relative` (KHÔNG đẩy layout
 *   các nút bên cạnh), kẹp hiển thị "9+".
 * - Mở popover → refetch ['notifications'] để đánh bại đua ghi của notification worker
 *   (OutboxDispatcher fan-out SSE TRƯỚC khi enqueue job ghi dòng IN_APP).
 * - Chỉ render text (title/body/created_at) — KHÔNG log metadata (có thể chứa PII khách).
 */
export function NotificationBell() {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const { data, refetch } = useNotifications();
  const markRead = useMarkNotificationRead();

  const items = data ?? [];
  const unread = unreadCount(items);
  const badge = unread > 9 ? '9+' : String(unread);

  const rtf = useMemo(() => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }), [locale]);
  const relative = (iso: string): string => {
    const min = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
    if (Math.abs(min) < 60) return rtf.format(min, 'minute');
    const hr = Math.round(min / 60);
    if (Math.abs(hr) < 24) return rtf.format(hr, 'hour');
    return rtf.format(Math.round(hr / 24), 'day');
  };

  const onRowClick = (id: string, isRead: boolean) => {
    if (isRead || markRead.isPending) return;
    markRead.mutate(id, {
      // 404 NOTIFICATION_NOT_FOUND (không phải dòng của user) → báo lỗi, giữ popover mở.
      onError: (err) => toast.error(err instanceof ApiClientError ? err.message : t('notifications.markReadError')),
    });
  };

  return (
    <Popover onOpenChange={(open) => open && void refetch()}>
      <div className="relative">
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('topbar.notifications')}>
            <Bell className="size-4.5" />
          </Button>
        </PopoverTrigger>
        {unread > 0 && (
          <span
            data-testid="notification-unread-count"
            className="pointer-events-none absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground"
          >
            {badge}
          </span>
        )}
      </div>

      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-b border-border px-4 py-2.5 text-sm font-semibold">{t('notifications.title')}</p>
        {items.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('notifications.empty')}</p>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onRowClick(n.id, n.is_read)}
                  aria-label={n.is_read ? undefined : t('notifications.markRead')}
                  className={cn(
                    'flex w-full flex-col gap-0.5 px-4 py-2.5 text-left transition-colors hover:bg-accent',
                    !n.is_read && 'bg-accent/40',
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {!n.is_read && <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden />}
                    {n.title}
                  </span>
                  <span className="text-xs text-muted-foreground">{n.body}</span>
                  <span className="text-[11px] text-muted-foreground/70">{relative(n.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
