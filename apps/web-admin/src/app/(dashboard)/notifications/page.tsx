'use client';

import { useMemo, useState } from 'react';
import { Button, Skeleton, cn, toast } from '@pms/ui';
import type { NotificationResponse } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import {
  NOTIFICATIONS_PAGE_LIMIT,
  useMarkNotificationRead,
  useNotificationList,
} from '@/lib/hooks/use-notifications';
import { useLocaleStore } from '@/stores/locale.store';
import { PageContainer, PageHeader } from '@/components/layout/page';

/**
 * N1 /notifications — trung tâm thông báo in-app của CHÍNH user (BE lọc theo
 * token.sub + channel IN_APP nên không lộ chéo user/tenant).
 *
 * Chỉ render title/body/thời gian — KHÔNG hiển thị `metadata` vì nó có thể chứa
 * thông tin cá nhân của khách (cùng nguyên tắc với chuông ở TopBar).
 */
export default function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, isLoading } = useNotificationList(unreadOnly);
  const markRead = useMarkNotificationRead();
  const locale = useLocaleStore((s) => s.locale);

  const items = data ?? [];
  const atLimit = items.length >= NOTIFICATIONS_PAGE_LIMIT;

  const dtf = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  );

  const onMarkRead = (n: NotificationResponse) => {
    if (n.is_read || markRead.isPending) return;
    markRead.mutate(n.id, {
      onError: (err) =>
        toast.error(err instanceof ApiClientError ? err.message : 'Đánh dấu đã đọc thất bại'),
    });
  };

  return (
    <PageContainer>
      <PageHeader
        title="Thông báo"
        description="Việc cần biết từ hệ thống: đặt phòng, thanh toán, dọn phòng, hoá đơn quá hạn."
        action={
          <Button variant="outline" onClick={() => setUnreadOnly((v) => !v)}>
            {unreadOnly ? 'Xem tất cả' : 'Chỉ chưa đọc'}
          </Button>
        }
      />

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-border px-3 py-8 text-center text-sm text-muted-foreground">
          {unreadOnly ? 'Không còn thông báo chưa đọc.' : 'Chưa có thông báo nào.'}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {items.map((n) => (
            <li key={n.id}>
              <div
                className={cn(
                  'flex flex-col gap-1 px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4',
                  !n.is_read && 'bg-accent/40',
                )}
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {!n.is_read && (
                      <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden />
                    )}
                    {n.title}
                  </p>
                  <p className="text-sm text-muted-foreground">{n.body}</p>
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground/70">
                    {dtf.format(new Date(n.created_at))}
                  </p>
                </div>
                {!n.is_read && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={markRead.isPending}
                    onClick={() => onMarkRead(n)}
                  >
                    Đánh dấu đã đọc
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {atLimit && (
        <p className="text-xs text-muted-foreground">
          Đang hiển thị {NOTIFICATIONS_PAGE_LIMIT} thông báo gần nhất — mốc tối đa hệ thống trả về
          một lần.
        </p>
      )}
    </PageContainer>
  );
}
