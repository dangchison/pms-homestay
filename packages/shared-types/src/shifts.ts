import { z } from 'zod';
import { OffsetPaginationQuerySchema } from './common';
import { PaymentResponseSchema } from './payment';

/**
 * Sổ quỹ ca + bàn giao ca (task 9.4, docs/16 #10 — Wave 1 chống thất thoát tiền mặt).
 * Ca thu ngân của MỘT cơ sở: mở ca ghi float đầu ca → thu tiền mặt trong ca → đóng
 * ca đếm tiền thực + so tiền kỳ vọng → chênh lệch (variance). Tiền = BIGINT ở DB,
 * số nguyên đồng trên API.
 */

export const ShiftStatusSchema = z.enum(['OPEN', 'CLOSED']);
export type ShiftStatus = z.infer<typeof ShiftStatusSchema>;

/**
 * POST /shifts — mở ca. opening_float_vnd = tiền lẻ/vốn đầu ca (>=0). opened_by/at
 * do server đặt. Idempotency-Key qua header (replay trả đúng ca cũ).
 */
export const OpenShiftRequestSchema = z.object({
  property_id: z.uuid(),
  opening_float_vnd: z.number().int().min(0),
  note: z.string().max(2000).optional(),
});
export type OpenShiftRequest = z.infer<typeof OpenShiftRequestSchema>;

/**
 * POST /shifts/:id/close — đóng ca. closing_counted_vnd = tiền mặt đếm thực tế
 * cuối ca (>=0). If-Match = version qua header. expected/variance server tính.
 */
export const CloseShiftRequestSchema = z.object({
  closing_counted_vnd: z.number().int().min(0),
  note: z.string().max(2000).optional(),
});
export type CloseShiftRequest = z.infer<typeof CloseShiftRequestSchema>;

/** Một ca (list + kết quả open/close). Các trường closing/expected/variance NULL khi OPEN. */
export const ShiftResponseSchema = z.object({
  id: z.uuid(),
  property_id: z.uuid(),
  opened_by: z.uuid(),
  opened_at: z.iso.datetime(),
  opening_float_vnd: z.number().int(),
  closed_by: z.uuid().nullable(),
  closed_at: z.iso.datetime().nullable(),
  closing_counted_vnd: z.number().int().nullable(),
  expected_cash_vnd: z.number().int().nullable(),
  variance_vnd: z.number().int().nullable(),
  status: ShiftStatusSchema,
  note: z.string().nullable(),
  version: z.number().int(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type ShiftResponse = z.infer<typeof ShiftResponseSchema>;

/** GET /shifts/:id — chi tiết ca + danh sách payment CASH thuộc cửa sổ/cơ sở của ca. */
export const ShiftDetailResponseSchema = ShiftResponseSchema.extend({
  cash_payments: z.array(PaymentResponseSchema),
});
export type ShiftDetailResponse = z.infer<typeof ShiftDetailResponseSchema>;

/** GET /shifts — danh sách + lọc theo cơ sở/trạng thái/khoảng ngày (offset paging). */
export const ShiftsListQuerySchema = OffsetPaginationQuerySchema.extend({
  property_id: z.uuid().optional(),
  status: ShiftStatusSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type ShiftsListQuery = z.infer<typeof ShiftsListQuerySchema>;
