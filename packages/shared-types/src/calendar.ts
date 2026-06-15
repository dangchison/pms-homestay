import { z } from 'zod';
import { BookingStatusSchema } from './booking';
import { BookingModeSchema } from './rate-plan';
import { BookableResourceTypeSchema } from './resource';
import { HousekeepingStatusSchema } from './room';

/**
 * Calendar timeline (task 6.2, spec ui/01 #C1). Đọc `room_occupancy` — KHÔNG tự
 * suy từ bookings — JOIN bookings/blocks để tóm tắt. Lịch hiển thị booking còn
 * occupancy (HOLD/PENDING/CONFIRMED/CHECKED_IN); terminal đã xoá occupancy nên
 * tự loại. `from`/`to` là biên khoảng đang xem (UTC ISO, nửa hở [from, to)).
 */
export const CalendarOccupancyQuerySchema = z
  .object({
    property_id: z.uuid(),
    from: z.iso.datetime(),
    to: z.iso.datetime(),
  })
  .refine((d) => new Date(d.to) > new Date(d.from), {
    message: 'to phải sau from',
    path: ['to'],
  });
export type CalendarOccupancyQuery = z.infer<typeof CalendarOccupancyQuerySchema>;

/** Một hàng trục Y — resource (ROOM hoặc WHOLE), kèm dot buồng phòng cho ROOM. */
export const CalendarResourceSchema = z.object({
  id: z.uuid(),
  property_id: z.uuid(),
  type: BookableResourceTypeSchema, // ROOM | WHOLE
  name: z.string(),
  is_active: z.boolean(),
  room_ids: z.array(z.uuid()),
  /** Chỉ ROOM (1 phòng thành viên) mới có dot housekeeping + số phòng. WHOLE = null. */
  housekeeping_status: HousekeepingStatusSchema.nullable(),
  room_number: z.string().nullable(),
});
export type CalendarResource = z.infer<typeof CalendarResourceSchema>;

/** Block booking trên một resource — `check_in/out` là giờ thực (bar chính), `occupancy_*` là khoảng có buffer (mờ 2 đầu). */
export const CalendarBookingSchema = z.object({
  id: z.uuid(),
  resource_id: z.uuid(),
  booking_code: z.string(),
  status: BookingStatusSchema,
  mode: BookingModeSchema,
  source: z.string(),
  check_in: z.iso.datetime(),
  check_out: z.iso.datetime(),
  occupancy_start: z.iso.datetime(),
  occupancy_end: z.iso.datetime(),
  guest_name: z.string().nullable(),
  adults: z.number().int(),
  children: z.number().int(),
  total_amount_vnd: z.number().int(),
  version: z.number().int(),
  /** Resource WHOLE → badge "Nguyên căn" + hiển thị trên mọi hàng phòng thành viên (visual span). */
  is_whole: z.boolean(),
});
export type CalendarBooking = z.infer<typeof CalendarBookingSchema>;

/** Room block (bảo trì…) — gắn vào MỌI resource chứa phòng bị chặn (ROOM + WHOLE bao phòng đó). */
export const CalendarBlockSchema = z.object({
  id: z.uuid(),
  resource_id: z.uuid(),
  room_id: z.uuid(),
  start_at: z.iso.datetime(),
  end_at: z.iso.datetime(),
  reason: z.string(),
});
export type CalendarBlock = z.infer<typeof CalendarBlockSchema>;

export const CalendarOccupancyResponseSchema = z.object({
  property_id: z.uuid(),
  from: z.string(),
  to: z.string(),
  resources: z.array(CalendarResourceSchema),
  bookings: z.array(CalendarBookingSchema),
  blocks: z.array(CalendarBlockSchema),
});
export type CalendarOccupancyResponse = z.infer<typeof CalendarOccupancyResponseSchema>;
