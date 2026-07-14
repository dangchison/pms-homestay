import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationResponse } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/**
 * Inbox thông báo in-app cho chuông TopBar (task 2.1, docs/19 §3 Đợt 2). BE
 * /notifications lọc SẴN theo user_id = token.sub + channel IN_APP (tenant-scoped)
 * nên KHÔNG cần @RequirePermissions và không lộ chéo user/tenant.
 *
 * KHÔNG có event_type "notification.dot" trong outbox (packages/shared-types/events.ts):
 * dòng IN_APP do notification worker sinh TỪ domain event (booking, payment, room…),
 * nên FE invalidate ['notifications'] trên MỌI domain event (use-events.ts) + refetch
 * khi mở popover (đánh bại đua ghi worker) thay vì trông chờ 1 event chuyên biệt.
 */

/** 20 thông báo mới nhất của user. res.data đã là mảng (BE bọc {data}) → trả thẳng. */
export function useNotifications() {
  return useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () =>
      apiClient.get<{ data: NotificationResponse[] }>('/notifications?limit=20').then((r) => r.data),
  });
}

/**
 * Đánh dấu 1 thông báo đã đọc: POST /notifications/:id/read (không body) →
 * onSuccess invalidate ['notifications'] (refetch list + badge). Lỗi 404
 * NOTIFICATION_NOT_FOUND xử lý ở onError phía component (toast) — không crash popover.
 */
export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/notifications/${id}/read`, undefined),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

/** Số thông báo chưa đọc (is_read === false). Pure → dùng cho badge + test đơn vị. */
export function unreadCount(items: NotificationResponse[]): number {
  return items.filter((n) => n.is_read === false).length;
}
