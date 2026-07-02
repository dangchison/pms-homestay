import { z } from 'zod';

/** Kênh gửi notification (docs/03 §4.10, docs/10 §7). */
export const NotificationChannelSchema = z.enum(['IN_APP', 'EMAIL', 'SMS', 'ZNS']);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

/** 1 dòng notifications trả cho FE (inbox in-app + log kênh khác). */
export const NotificationResponseSchema = z.object({
  id: z.uuid(),
  channel: NotificationChannelSchema,
  title: z.string(),
  body: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  is_read: z.boolean(),
  read_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
});
export type NotificationResponse = z.infer<typeof NotificationResponseSchema>;

/** GET /notifications?unread_only=&limit= */
export const ListNotificationsQuerySchema = z.object({
  unread_only: z.stringbool().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;

// ── Outbound messages (Đợt 4 / M1) — sổ gửi kênh ngoài SMS/ZNS/EMAIL ─────────

/** Kênh gửi ngoài (bảng outbound_messages — KHÔNG có IN_APP). */
export const OutboundChannelSchema = z.enum(['SMS', 'ZNS', 'EMAIL']);
export type OutboundChannel = z.infer<typeof OutboundChannelSchema>;

/** Trạng thái gửi ngoài. */
export const OutboundStatusSchema = z.enum(['PENDING', 'SENT', 'FAILED']);
export type OutboundStatus = z.infer<typeof OutboundStatusSchema>;

/** 1 dòng outbound_messages trả cho FE/audit (GET /notifications/outbound). */
export const OutboundMessageResponseSchema = z.object({
  id: z.uuid(),
  channel: OutboundChannelSchema,
  provider: z.string(),
  provider_message_id: z.string().nullable(),
  recipient: z.string(),
  title: z.string(),
  status: OutboundStatusSchema,
  created_at: z.iso.datetime(),
});
export type OutboundMessageResponse = z.infer<typeof OutboundMessageResponseSchema>;

/** GET /notifications/outbound?channel=&limit= (tenant-scoped, audit_log.read). */
export const ListOutboundMessagesQuerySchema = z.object({
  channel: OutboundChannelSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListOutboundMessagesQuery = z.infer<typeof ListOutboundMessagesQuerySchema>;
