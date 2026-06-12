import { type ClaimedOutboxEvent } from './outbox.service';

/**
 * Seam dispatcher → notifications (docs/10 §7) KHÔNG để core/outbox phụ thuộc
 * modules/notifications. OutboxDispatcher inject `@Optional()` token này; nếu
 * NotificationsModule có mặt (provide NOTIFICATION_SINK) thì dispatcher enqueue
 * notification job sau khi fan-out SSE. Nếu vắng → bỏ qua (vẫn chạy SSE).
 */
export const NOTIFICATION_SINK = Symbol('NOTIFICATION_SINK');

export interface NotificationSink {
  /** Enqueue notification cho 1 outbox event (không gửi trực tiếp — docs/10 §7). */
  enqueue(event: ClaimedOutboxEvent): Promise<void>;
}
