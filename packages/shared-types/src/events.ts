import { z } from 'zod';

/**
 * Domain event đi qua Transactional Outbox (docs/10).
 * Map event_type chi tiết bổ sung ở task 4.2/4.3 — đây là envelope chung.
 */
export const DomainEventSchema = z.object({
  id: z.uuid(),
  /** vd: booking.created, payment.succeeded — thêm dần theo docs/10 §2 */
  event_type: z.string().min(1),
  tenant_id: z.uuid(),
  aggregate_type: z.string().min(1),
  aggregate_id: z.uuid(),
  payload: z.record(z.string(), z.unknown()),
  occurred_at: z.iso.datetime(),
});
export type DomainEvent = z.infer<typeof DomainEventSchema>;
