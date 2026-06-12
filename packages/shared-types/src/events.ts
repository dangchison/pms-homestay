import { z } from 'zod';

/**
 * Domain events qua Transactional Outbox (docs/10). Naming `<aggregate>.<verb_past>`.
 * Catalog docs/10 §2 — module emit (task 4.3) chỉ dùng các type ở đây để client
 * map sang queryKey cần invalidate.
 */
export const EVENT_TYPES = [
  'booking.created',
  'booking.confirmed',
  'booking.cancelled',
  'booking.no_show',
  'booking.checked_in',
  'booking.checked_out',
  'booking.resource_switched',
  'booking.overbooking_detected',
  'room.housekeeping_changed',
  'room.blocked',
  'room.unblocked',
  'payment.received',
  'payment.refunded',
  'invoice.issued',
  'invoice.overdue',
  'cleaning_task.assigned',
  'cleaning_task.completed',
  'sync_job.completed',
  'sync_job.failed',
] as const;

export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

/**
 * Input cho `outbox.publish(tx, input)` (docs/10 §3) — tenant_id KHÔNG truyền tay,
 * suy ra từ tenant-tx (current_setting) để luôn khớp RLS context. Payload chỉ chứa
 * dữ liệu tối thiểu để route/invalidate (id, không nhét cả entity — docs/10 §2).
 */
export const OutboxPublishInputSchema = z.object({
  event_type: EventTypeSchema,
  aggregate_type: z.string().min(1),
  aggregate_id: z.uuid(),
  /** property_id nên có mặt để filter SSE theo property (docs/10 §5). */
  payload: z.record(z.string(), z.unknown()),
});
export type OutboxPublishInput = z.infer<typeof OutboxPublishInputSchema>;

/**
 * Domain event đi qua Transactional Outbox — bản ghi đầy đủ (1 dòng outbox_events).
 */
export const DomainEventSchema = z.object({
  id: z.uuid(),
  /** vd: booking.created, payment.received — catalog ở EVENT_TYPES */
  event_type: z.string().min(1),
  tenant_id: z.uuid(),
  aggregate_type: z.string().min(1),
  aggregate_id: z.uuid(),
  payload: z.record(z.string(), z.unknown()),
  occurred_at: z.iso.datetime(),
});
export type DomainEvent = z.infer<typeof DomainEventSchema>;

/**
 * Gói tin SSE đẩy xuống client (docs/10 §3 dispatchOne + §4). Tối giản — client
 * dedup theo `event_id` (at-least-once) rồi map `event_type` → invalidateQueries.
 * `ts` = thời điểm event xảy ra (outbox_events.created_at).
 */
export const RealtimeEventSchema = z.object({
  event_id: z.uuid(),
  event_type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  ts: z.iso.datetime(),
});
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;
