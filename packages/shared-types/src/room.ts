import { z } from 'zod';

/** Trạng thái buồng phòng (docs/03 §2 enum housekeeping_status). */
export const HousekeepingStatusSchema = z.enum(['CLEAN', 'DIRTY', 'CLEANING', 'INSPECTION']);
export type HousekeepingStatus = z.infer<typeof HousekeepingStatusSchema>;

/**
 * Phòng VẬT LÝ (docs/03 §4.3): KHÔNG có giá, KHÔNG có rent_mode,
 * KHÔNG có availability — trạng thái "đang có khách" derive từ room_occupancy.
 */
export const CreateRoomRequestSchema = z.object({
  property_id: z.uuid(),
  room_number: z.string().min(1).max(50),
  display_name: z.string().max(255).optional(),
  description: z.string().optional(),
  capacity_adults: z.number().int().min(1).optional(),
  capacity_children: z.number().int().min(0).optional(),
  size_sqm: z.number().positive().optional(),
  amenities: z.array(z.string()).optional(),
  photos: z.array(z.string()).optional(),
  buffer_minutes: z.number().int().min(0).optional(), // đệm dọn phòng; 0 cho HOURLY
  notes: z.string().optional(),
});
export type CreateRoomRequest = z.infer<typeof CreateRoomRequestSchema>;

/** PATCH room: KHÔNG đổi property_id (phòng không di chuyển giữa cơ sở). */
export const UpdateRoomRequestSchema = z
  .object({
    display_name: z.string().max(255).optional(),
    description: z.string().optional(),
    housekeeping_status: HousekeepingStatusSchema.optional(),
    capacity_adults: z.number().int().min(1).optional(),
    capacity_children: z.number().int().min(0).optional(),
    size_sqm: z.number().positive().optional(),
    amenities: z.array(z.string()).optional(),
    photos: z.array(z.string()).optional(),
    is_active: z.boolean().optional(),
    buffer_minutes: z.number().int().min(0).optional(),
    notes: z.string().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Cần ít nhất một trường để cập nhật' });
export type UpdateRoomRequest = z.infer<typeof UpdateRoomRequestSchema>;

export const RoomResponseSchema = z.object({
  id: z.uuid(),
  property_id: z.uuid(),
  room_number: z.string(),
  display_name: z.string().nullable(),
  description: z.string().nullable(),
  housekeeping_status: HousekeepingStatusSchema,
  capacity_adults: z.number().int(),
  capacity_children: z.number().int(),
  size_sqm: z.number().nullable(),
  amenities: z.array(z.string()),
  photos: z.array(z.string()),
  is_active: z.boolean(),
  buffer_minutes: z.number().int(),
  notes: z.string().nullable(),
  version: z.number().int(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type RoomResponse = z.infer<typeof RoomResponseSchema>;

// ── Room blocks (chặn phòng — bảo trì/owner dùng) ───────────────────────────

export const CreateRoomBlockRequestSchema = z
  .object({
    room_id: z.uuid(),
    start_at: z.iso.datetime(),
    end_at: z.iso.datetime(),
    reason: z.string().min(1).max(255), // MAINTENANCE | OWNER_USE | RENOVATION
  })
  .refine((d) => new Date(d.end_at) > new Date(d.start_at), {
    message: 'end_at phải sau start_at',
    path: ['end_at'],
  });
export type CreateRoomBlockRequest = z.infer<typeof CreateRoomBlockRequestSchema>;

export const RoomBlockResponseSchema = z.object({
  id: z.uuid(),
  room_id: z.uuid(),
  start_at: z.iso.datetime(),
  end_at: z.iso.datetime(),
  reason: z.string(),
  created_by: z.uuid().nullable(),
  created_at: z.iso.datetime(),
});
export type RoomBlockResponse = z.infer<typeof RoomBlockResponseSchema>;
