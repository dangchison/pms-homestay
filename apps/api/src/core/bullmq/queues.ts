/**
 * Tên queue BullMQ (docs/01 §queue, docs/13). Khai báo tập trung để tránh gõ
 * sai chuỗi giữa producer (registerQueue) và consumer (@Processor).
 *
 * Mỗi domain một queue riêng (không gộp) — fail/retry/metric tách bạch
 * (docs/11 §metrics: queue depth + fail count theo queue).
 */
export const QUEUE_HOLD_EXPIRY = 'hold-expiry';
export const QUEUE_PAYMENT_RECONCILE = 'payment-reconcile';
export const QUEUE_NIGHT_AUDIT = 'night-audit';
export const QUEUE_NOTIFICATIONS = 'notifications';
export const QUEUE_ICAL_PULL = 'ical-pull';
