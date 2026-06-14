import { z } from 'zod';
import { OffsetPageInfoSchema } from './common';

/**
 * Việc dọn phòng (task 4.1, docs/03 §4.9). Sinh tự động khi booking CHECKED_OUT
 * (+ phòng cũ khi switch-resource) hoặc tạo tay (DEEP_CLEAN/MAINTENANCE). Vòng đời
 * PENDING→IN_PROGRESS→COMPLETED→VERIFIED (+ CANCELLED) gắn với rooms.housekeeping_status
 * (DIRTY→CLEANING→INSPECTION→CLEAN). Ảnh before/after lưu key S3 (client upload qua
 * pre-signed PUT).
 */
export const CleaningTaskStatusSchema = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'VERIFIED',
  'CANCELLED',
]);
export type CleaningTaskStatus = z.infer<typeof CleaningTaskStatusSchema>;

export const CleaningTaskTypeSchema = z.enum(['CHECKOUT_CLEAN', 'DEEP_CLEAN', 'MAINTENANCE']);
export type CleaningTaskType = z.infer<typeof CleaningTaskTypeSchema>;

/** Key object S3 (do presign sinh ra server-side). */
const PhotoKeySchema = z.string().min(1).max(512);

/** Tạo task thủ công (DEEP_CLEAN/MAINTENANCE thường dùng; CHECKOUT_CLEAN auto-sinh). */
export const CreateCleaningTaskRequestSchema = z.object({
  property_id: z.uuid(),
  room_id: z.uuid(),
  booking_id: z.uuid().nullable().optional(),
  task_type: CleaningTaskTypeSchema.default('CHECKOUT_CLEAN'),
  assigned_to: z.uuid().nullable().optional(),
  priority: z.number().int().min(0).max(9).default(0),
  due_at: z.iso.datetime().nullable().optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateCleaningTaskRequest = z.infer<typeof CreateCleaningTaskRequestSchema>;

/** PATCH (If-Match) — chỉ trường điều phối; không đổi status qua đây (dùng action). */
export const UpdateCleaningTaskRequestSchema = z
  .object({
    assigned_to: z.uuid().nullable(),
    priority: z.number().int().min(0).max(9),
    due_at: z.iso.datetime().nullable(),
    notes: z.string().max(2000).nullable(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'Cần ít nhất một trường để cập nhật' });
export type UpdateCleaningTaskRequest = z.infer<typeof UpdateCleaningTaskRequestSchema>;

/** Gán/đổi người dọn (status giữ nguyên — emit cleaning_task.assigned). */
export const AssignCleaningTaskRequestSchema = z.object({
  assigned_to: z.uuid(),
});
export type AssignCleaningTaskRequest = z.infer<typeof AssignCleaningTaskRequestSchema>;

/** Bắt đầu dọn (PENDING→IN_PROGRESS) — đính ảnh "trước" (tuỳ chọn). */
export const StartCleaningTaskRequestSchema = z.object({
  before_photos: z.array(PhotoKeySchema).max(20).optional(),
});
export type StartCleaningTaskRequest = z.infer<typeof StartCleaningTaskRequestSchema>;

/** Hoàn tất (IN_PROGRESS→COMPLETED) — đính ảnh "sau" + ghi chú (tuỳ chọn). */
export const CompleteCleaningTaskRequestSchema = z.object({
  after_photos: z.array(PhotoKeySchema).max(20).optional(),
  notes: z.string().max(2000).optional(),
});
export type CompleteCleaningTaskRequest = z.infer<typeof CompleteCleaningTaskRequestSchema>;

/** Nghiệm thu (COMPLETED→VERIFIED) — phòng về CLEAN. */
export const VerifyCleaningTaskRequestSchema = z.object({
  notes: z.string().max(2000).optional(),
});
export type VerifyCleaningTaskRequest = z.infer<typeof VerifyCleaningTaskRequestSchema>;

/** Huỷ task (PENDING/IN_PROGRESS → CANCELLED) — cần lý do. */
export const CancelCleaningTaskRequestSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type CancelCleaningTaskRequest = z.infer<typeof CancelCleaningTaskRequestSchema>;

/** Xin URL pre-signed để upload 1 ảnh lên S3 (PUT trực tiếp từ client). */
export const PresignPhotoRequestSchema = z.object({
  phase: z.enum(['before', 'after']),
  content_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
});
export type PresignPhotoRequest = z.infer<typeof PresignPhotoRequestSchema>;

export const PresignPhotoResponseSchema = z.object({
  key: z.string(), // đính vào before_photos/after_photos sau khi upload xong
  upload_url: z.string(), // PUT URL có chữ ký (hết hạn theo expires_in)
  expires_in: z.number().int(), // giây
});
export type PresignPhotoResponse = z.infer<typeof PresignPhotoResponseSchema>;

export const CleaningTaskResponseSchema = z.object({
  id: z.uuid(),
  property_id: z.uuid(),
  room_id: z.uuid(),
  booking_id: z.uuid().nullable(),
  task_type: CleaningTaskTypeSchema,
  status: CleaningTaskStatusSchema,
  assigned_to: z.uuid().nullable(),
  priority: z.number().int(),
  due_at: z.iso.datetime().nullable(),
  started_at: z.iso.datetime().nullable(),
  completed_at: z.iso.datetime().nullable(),
  verified_by: z.uuid().nullable(),
  verified_at: z.iso.datetime().nullable(),
  notes: z.string().nullable(),
  before_photos: z.array(z.string()),
  after_photos: z.array(z.string()),
  version: z.number().int(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type CleaningTaskResponse = z.infer<typeof CleaningTaskResponseSchema>;

export const CleaningTaskListResponseSchema = z.object({
  data: z.array(CleaningTaskResponseSchema),
  page_info: OffsetPageInfoSchema,
});
export type CleaningTaskListResponse = z.infer<typeof CleaningTaskListResponseSchema>;
