import { z } from 'zod';
import { BookingModeSchema } from './rate-plan';

export const BookingStatusSchema = z.enum([
  'HOLD',
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'CANCELLED',
  'NO_SHOW',
]);
export type BookingStatus = z.infer<typeof BookingStatusSchema>;

/** Nguồn đặt tay qua API (OTA đi qua sync — task 5.x). */
export const BookingSourceSchema = z.enum(['DIRECT', 'WALK_IN']);
export type BookingSource = z.infer<typeof BookingSourceSchema>;

/** POST /bookings (docs/05 §13). quote_id BẮT BUỘC — server verify giá (07 §6). */
export const CreateBookingRequestSchema = z
  .object({
    resource_id: z.uuid(),
    quote_id: z.uuid(),
    guest_id: z.uuid().optional(),
    mode: BookingModeSchema,
    check_in: z.iso.datetime(),
    check_out: z.iso.datetime(),
    adults: z.number().int().min(1).optional(),
    children: z.number().int().min(0).optional(),
    source: BookingSourceSchema.optional(),
    hold: z.boolean().optional(), // true → HOLD (giữ 10'); else PENDING
    notes: z.string().max(1000).optional(),
  })
  .refine((d) => new Date(d.check_out) > new Date(d.check_in), {
    message: 'check_out phải sau check_in',
    path: ['check_out'],
  });
export type CreateBookingRequest = z.infer<typeof CreateBookingRequestSchema>;

/** PATCH /bookings/:id — sửa thông tin không đụng occupancy (đổi resource = switch-resource 2.8). */
export const UpdateBookingRequestSchema = z
  .object({
    guest_id: z.uuid().optional(),
    adults: z.number().int().min(1).optional(),
    children: z.number().int().min(0).optional(),
    notes: z.string().max(1000).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Cần ít nhất một trường để cập nhật' });
export type UpdateBookingRequest = z.infer<typeof UpdateBookingRequestSchema>;

export const CancelBookingRequestSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type CancelBookingRequest = z.infer<typeof CancelBookingRequestSchema>;

/**
 * POST /bookings/:id/confirm (docs/06 §4, task 2.7). Mặc định HOLD → PENDING
 * (đặt hạn cọc). `force` (CHỈ OWNER) → CONFIRMED luôn, bỏ qua bước cọc.
 */
export const ConfirmBookingRequestSchema = z.object({
  force: z.boolean().optional(),
});
export type ConfirmBookingRequest = z.infer<typeof ConfirmBookingRequestSchema>;

/**
 * POST /bookings/:id/switch-resource (docs/06 §6, task 2.8) — đổi phòng/bookable
 * resource: tx delete+reinsert occupancy ở resource mới (EXCLUDE chặn nếu bận).
 * resource mới phải cùng property với booking.
 */
export const SwitchResourceRequestSchema = z.object({
  new_resource_id: z.uuid(),
  reason: z.string().min(1).max(500),
});
export type SwitchResourceRequest = z.infer<typeof SwitchResourceRequestSchema>;

/**
 * Bảng "Hôm nay" cho web-staff (task 6.6, ui/02 #T2). 3 nhóm theo NGÀY ở timezone
 * cơ sở: đến (chờ check-in), đi (đang ở, trả hôm nay), đang ở (ở qua hôm nay).
 * `date` mặc định = hôm nay (server tính theo properties.timezone).
 */
export const TodayBoardQuerySchema = z.object({
  property_id: z.uuid(),
  date: z.iso.date().optional(), // YYYY-MM-DD
});
export type TodayBoardQuery = z.infer<typeof TodayBoardQuerySchema>;

/** 1 thẻ booking trên bảng hôm nay — đủ để render card + điều hướng check-in/out. */
export const TodayBookingCardSchema = z.object({
  id: z.uuid(),
  booking_code: z.string(),
  status: BookingStatusSchema,
  mode: BookingModeSchema,
  resource_id: z.uuid(),
  resource_name: z.string(),
  is_whole: z.boolean(),
  guest_name: z.string().nullable(),
  guest_id: z.uuid().nullable(),
  check_in: z.iso.datetime(),
  check_out: z.iso.datetime(),
  adults: z.number().int(),
  children: z.number().int(),
  /** Tổng còn nợ trên mọi invoice của booking (ISSUED/PARTIALLY_PAID/OVERDUE). */
  balance_due_vnd: z.number().int(),
  /** Còn nợ riêng trên invoice DEPOSIT — gate check-in (cọc chưa đủ). */
  deposit_due_vnd: z.number().int(),
});
export type TodayBookingCard = z.infer<typeof TodayBookingCardSchema>;

export const TodayBoardResponseSchema = z.object({
  property_id: z.uuid(),
  date: z.iso.date(),
  arrivals: z.array(TodayBookingCardSchema),
  departures: z.array(TodayBookingCardSchema),
  in_house: z.array(TodayBookingCardSchema),
});
export type TodayBoardResponse = z.infer<typeof TodayBoardResponseSchema>;

export const BookingResponseSchema = z.object({
  id: z.uuid(),
  property_id: z.uuid(),
  resource_id: z.uuid(),
  guest_id: z.uuid().nullable(),
  booking_code: z.string(),
  source: z.string(),
  status: BookingStatusSchema,
  mode: BookingModeSchema,
  rate_plan_id: z.uuid().nullable(),
  quote_id: z.uuid().nullable(),
  check_in: z.iso.datetime(),
  check_out: z.iso.datetime(),
  actual_check_in: z.iso.datetime().nullable(),
  actual_check_out: z.iso.datetime().nullable(),
  adults: z.number().int(),
  children: z.number().int(),
  total_amount_vnd: z.number().int(),
  commission_vnd: z.number().int(),
  notes: z.string().nullable(),
  cancellation_reason: z.string().nullable(),
  cancelled_at: z.iso.datetime().nullable(),
  expires_at: z.iso.datetime().nullable(),
  version: z.number().int(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type BookingResponse = z.infer<typeof BookingResponseSchema>;
