import { z } from 'zod';

/**
 * Tiền VND: BIGINT ở DB, số nguyên đồng trên API (không có đơn vị lẻ).
 * Mọi phép làm tròn đi qua roundVnd() của @pms/pricing-engine (docs/01 §4).
 */
export const MoneyVndSchema = z.number().int();
export type MoneyVnd = z.infer<typeof MoneyVndSchema>;

// ── Pagination (docs/05 §pagination) ─────────────────────────────────────────

/** Cursor-based — danh sách lớn (bookings, audit logs). */
export const CursorPaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export type CursorPaginationQuery = z.infer<typeof CursorPaginationQuerySchema>;

export const CursorPageInfoSchema = z.object({
  has_next: z.boolean(),
  next_cursor: z.string().nullable(),
  limit: z.number().int(),
});
export type CursorPageInfo = z.infer<typeof CursorPageInfoSchema>;

/** Offset-based — danh sách nhỏ (properties, users). */
export const OffsetPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
export type OffsetPaginationQuery = z.infer<typeof OffsetPaginationQuerySchema>;

export const OffsetPageInfoSchema = z.object({
  page: z.number().int(),
  page_size: z.number().int(),
  total_items: z.number().int(),
  total_pages: z.number().int(),
});
export type OffsetPageInfo = z.infer<typeof OffsetPageInfoSchema>;

// ── Error format RFC 7807 + extensions (docs/05 §error) ─────────────────────

export const ApiErrorFieldSchema = z.object({
  field: z.string(),
  code: z.string(),
  message: z.string(),
});
export type ApiErrorField = z.infer<typeof ApiErrorFieldSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    /** URI tài liệu lỗi: https://docs.pmsapp.vn/errors/<code> */
    type: z.string(),
    /** Mã máy đọc được, prefix theo domain: AUTH_, BOOKING_, PAYMENT_, ... */
    code: z.string(),
    /** Thông điệp ngắn cho người dùng (đã localize) */
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    request_id: z.string().optional(),
    fields: z.array(ApiErrorFieldSchema).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
