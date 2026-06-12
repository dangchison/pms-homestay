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
