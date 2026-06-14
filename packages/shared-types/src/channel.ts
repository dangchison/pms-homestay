import { z } from 'zod';

/**
 * Channel / OTA sync (task 5.1, docs/03 §4.8). Kênh iCal (Airbnb/Booking/Agoda)
 * hoặc API (Channex). secret (api_key) trong config mã hoá AES-256-GCM (ADR-0007)
 * — KHÔNG bao giờ trả plaintext (response chỉ có cờ has_secret).
 */
export const ChannelTypeSchema = z.enum([
  'AIRBNB_ICAL',
  'BOOKING_ICAL',
  'AGODA_ICAL',
  'CHANNEX_API',
]);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

export const SyncJobStatusSchema = z.enum(['QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL']);
export type SyncJobStatus = z.infer<typeof SyncJobStatusSchema>;

/** Config kênh: api_key (secret — sẽ mã hoá) + field tự do khác. */
export const ChannelConfigSchema = z
  .object({ api_key: z.string().min(1).optional() })
  .catchall(z.unknown());
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;

// ── Channel ──────────────────────────────────────────────────────────────────
export const CreateChannelRequestSchema = z.object({
  property_id: z.uuid(),
  channel_type: ChannelTypeSchema,
  display_name: z.string().min(1).max(255),
  config: ChannelConfigSchema.default({}),
  is_active: z.boolean().optional(),
});
export type CreateChannelRequest = z.infer<typeof CreateChannelRequestSchema>;

export const UpdateChannelRequestSchema = z
  .object({
    display_name: z.string().min(1).max(255),
    config: ChannelConfigSchema,
    is_active: z.boolean(),
  })
  .partial();
export type UpdateChannelRequest = z.infer<typeof UpdateChannelRequestSchema>;

export const ChannelResponseSchema = z.object({
  id: z.uuid(),
  property_id: z.uuid(),
  channel_type: ChannelTypeSchema,
  display_name: z.string(),
  config: z.record(z.string(), z.unknown()), // ĐÃ mask secret (không có api_key/api_key_enc)
  has_secret: z.boolean(), // có api_key mã hoá hay không
  is_active: z.boolean(),
  last_synced_at: z.iso.datetime().nullable(),
  last_sync_status: SyncJobStatusSchema.nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type ChannelResponse = z.infer<typeof ChannelResponseSchema>;

// ── Channel ↔ Resource mapping ────────────────────────────────────────────────
export const CreateChannelMappingRequestSchema = z.object({
  resource_id: z.uuid(),
  external_listing_id: z.string().min(1).max(255),
  external_listing_url: z.string().max(2048).optional(),
  ical_pull_url: z.string().max(2048).optional(),
  is_active: z.boolean().optional(),
});
export type CreateChannelMappingRequest = z.infer<typeof CreateChannelMappingRequestSchema>;

export const UpdateChannelMappingRequestSchema = z
  .object({
    external_listing_id: z.string().min(1).max(255),
    external_listing_url: z.string().max(2048).nullable(),
    ical_pull_url: z.string().max(2048).nullable(),
    is_active: z.boolean(),
  })
  .partial();
export type UpdateChannelMappingRequest = z.infer<typeof UpdateChannelMappingRequestSchema>;

export const ChannelMappingResponseSchema = z.object({
  id: z.uuid(),
  channel_id: z.uuid(),
  resource_id: z.uuid(),
  external_listing_id: z.string(),
  external_listing_url: z.string().nullable(),
  ical_pull_url: z.string().nullable(),
  ical_push_token: z.string(), // secret push — trả cho owner để dán vào OTA
  is_active: z.boolean(),
  last_pulled_at: z.iso.datetime().nullable(),
  last_event_count: z.number().int(),
  created_at: z.iso.datetime(),
});
export type ChannelMappingResponse = z.infer<typeof ChannelMappingResponseSchema>;

// ── Sync jobs (task 5.2) ──────────────────────────────────────────────────────
export const SyncJobResponseSchema = z.object({
  id: z.uuid(),
  channel_id: z.uuid(),
  channel_mapping_id: z.uuid().nullable(),
  job_type: z.string(),
  status: SyncJobStatusSchema,
  started_at: z.iso.datetime(),
  finished_at: z.iso.datetime().nullable(),
  events_processed: z.number().int(),
  events_created: z.number().int(),
  events_updated: z.number().int(),
  events_removed: z.number().int(),
  conflict_count: z.number().int(),
  error_message: z.string().nullable(),
});
export type SyncJobResponse = z.infer<typeof SyncJobResponseSchema>;

/** Kết quả 1 lần iCal pull (trả ở POST sync-now). */
export const IcalSyncResultSchema = z.object({
  status: SyncJobStatusSchema,
  feed_count: z.number().int(),
  created: z.number().int(),
  cancelled: z.number().int(),
  conflicts: z.number().int(),
  skipped: z.number().int(),
  guard_triggered: z.boolean(),
});
export type IcalSyncResult = z.infer<typeof IcalSyncResultSchema>;
