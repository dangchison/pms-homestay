import { z } from 'zod';

/** Loại đơn vị bán được (docs/03 §2 enum bookable_resource_type, ADR-0006). */
export const BookableResourceTypeSchema = z.enum(['ROOM', 'WHOLE']);
export type BookableResourceType = z.infer<typeof BookableResourceTypeSchema>;

/**
 * Tạo resource WHOLE (nguyên căn) — chọn các phòng thành viên (ADR-0006).
 * Resource ROOM được TỰ SINH khi tạo room (1:1), không tạo qua endpoint này.
 */
export const CreateWholeResourceRequestSchema = z.object({
  property_id: z.uuid(),
  name: z.string().min(1).max(255),
  room_ids: z.array(z.uuid()).min(1, 'Nguyên căn cần ít nhất 1 phòng thành viên'),
});
export type CreateWholeResourceRequest = z.infer<typeof CreateWholeResourceRequestSchema>;

/** Cập nhật resource WHOLE: tên và/hoặc danh sách phòng thành viên, bật/tắt. */
export const UpdateResourceRequestSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    room_ids: z.array(z.uuid()).min(1).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Cần ít nhất một trường để cập nhật' });
export type UpdateResourceRequest = z.infer<typeof UpdateResourceRequestSchema>;

export const BookableResourceResponseSchema = z.object({
  id: z.uuid(),
  property_id: z.uuid(),
  type: BookableResourceTypeSchema,
  name: z.string(),
  is_active: z.boolean(),
  room_ids: z.array(z.uuid()), // phòng thành viên (resource_members)
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type BookableResourceResponse = z.infer<typeof BookableResourceResponseSchema>;
