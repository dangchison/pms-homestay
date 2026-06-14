import {
  AssignCleaningTaskRequestSchema,
  CancelCleaningTaskRequestSchema,
  CleaningTaskStatusSchema,
  CompleteCleaningTaskRequestSchema,
  CreateCleaningTaskRequestSchema,
  OffsetPaginationQuerySchema,
  PresignPhotoRequestSchema,
  StartCleaningTaskRequestSchema,
  UpdateCleaningTaskRequestSchema,
  VerifyCleaningTaskRequestSchema,
} from '@pms/shared-types';
import { z } from 'zod';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class CreateCleaningTaskDto extends createZodDto(CreateCleaningTaskRequestSchema) {}
export class UpdateCleaningTaskDto extends createZodDto(UpdateCleaningTaskRequestSchema) {}
export class AssignCleaningTaskDto extends createZodDto(AssignCleaningTaskRequestSchema) {}
export class StartCleaningTaskDto extends createZodDto(StartCleaningTaskRequestSchema) {}
export class CompleteCleaningTaskDto extends createZodDto(CompleteCleaningTaskRequestSchema) {}
export class VerifyCleaningTaskDto extends createZodDto(VerifyCleaningTaskRequestSchema) {}
export class CancelCleaningTaskDto extends createZodDto(CancelCleaningTaskRequestSchema) {}
export class PresignPhotoDto extends createZodDto(PresignPhotoRequestSchema) {}

/** Danh sách task theo cơ sở (property_id bắt buộc — RBAC pha-2 theo property). */
const CleaningTaskListQuerySchema = OffsetPaginationQuerySchema.extend({
  property_id: z.uuid(),
  status: CleaningTaskStatusSchema.optional(),
  assigned_to: z.uuid().optional(),
  room_id: z.uuid().optional(),
});
export class CleaningTaskListQueryDto extends createZodDto(CleaningTaskListQuerySchema) {}
