import {
  CreateExpenseRequestSchema,
  ExpenseTypeSchema,
  OffsetPaginationQuerySchema,
  UpdateExpenseRequestSchema,
} from '@pms/shared-types';
import { z } from 'zod';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class CreateExpenseDto extends createZodDto(CreateExpenseRequestSchema) {}
export class UpdateExpenseDto extends createZodDto(UpdateExpenseRequestSchema) {}

/** Danh sách chi phí theo cơ sở (property_id bắt buộc — RBAC pha-2) + lọc loại/khoảng ngày. */
const ExpenseListQuerySchema = OffsetPaginationQuerySchema.extend({
  property_id: z.uuid(),
  expense_type: ExpenseTypeSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export class ExpenseListQueryDto extends createZodDto(ExpenseListQuerySchema) {}
