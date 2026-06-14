import { z } from 'zod';
import { OffsetPageInfoSchema, OffsetPaginationQuerySchema } from './common';

/**
 * Audit log (task 4.5, docs/03 §audit_logs). Vết kiểm toán append-only:
 * AuditInterceptor tự ghi mutation (CREATE/UPDATE/DELETE/STATE_CHANGE), service
 * ghi tường minh action nhạy cảm (READ_PII/LOGIN/LOGOUT/EXPORT).
 */
export const AuditActionSchema = z.enum([
  'CREATE',
  'UPDATE',
  'DELETE',
  'STATE_CHANGE',
  'LOGIN',
  'LOGOUT',
  'EXPORT',
  'READ_PII',
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

/** 1 dòng audit_logs trả qua API (before/after đã redact PII khi ghi). */
export const AuditLogResponseSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid().nullable(),
  action: AuditActionSchema,
  entity_type: z.string(),
  entity_id: z.uuid().nullable(),
  before_data: z.unknown().nullable(),
  after_data: z.unknown().nullable(),
  diff: z.unknown().nullable(),
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  request_id: z.string().nullable(),
  created_at: z.iso.datetime(),
});
export type AuditLogResponse = z.infer<typeof AuditLogResponseSchema>;

/**
 * GET /audit-logs — offset-based (nhất quán với danh sách khác trong hệ; index
 * idx_audit_tenant_time + filter giữ truy vấn nhanh). Lọc theo entity/action/user
 * + khoảng thời gian (from/to ISO, nửa mở [from, to)).
 */
export const AuditLogListQuerySchema = OffsetPaginationQuerySchema.extend({
  entity_type: z.string().max(64).optional(),
  entity_id: z.uuid().optional(),
  action: AuditActionSchema.optional(),
  user_id: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export type AuditLogListQuery = z.infer<typeof AuditLogListQuerySchema>;

export const AuditLogListResponseSchema = z.object({
  data: z.array(AuditLogResponseSchema),
  page_info: OffsetPageInfoSchema,
});
export type AuditLogListResponse = z.infer<typeof AuditLogListResponseSchema>;
