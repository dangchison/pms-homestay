import { z } from 'zod';
import { MoneyVndSchema } from './common';

export const ExpenseTypeSchema = z.enum([
  'RENT_LANDLORD',
  'ELECTRICITY',
  'WATER',
  'INTERNET',
  'GAS',
  'AMENITIES',
  'CLEANING_SUPPLIES',
  'STAFF_SALARY',
  'MAINTENANCE',
  'MARKETING',
  'OTA_COMMISSION',
  'PLATFORM_FEE',
  'TAX',
  'OTHER',
]);
export type ExpenseType = z.infer<typeof ExpenseTypeSchema>;

export const RecurrencePatternSchema = z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']);
export type RecurrencePattern = z.infer<typeof RecurrencePatternSchema>;

/**
 * Tạo chi phí thủ công. `OTA_COMMISSION` là CẤM nhập tay — chỉ hệ thống auto-sinh
 * khi booking CHECKED_OUT (docs/09 §6). `is_recurring` → đây là template, night-audit
 * sinh child theo `recurrence_pattern` (source_booking_id/parent_expense_id do hệ
 * thống đặt, không nhận qua API).
 */
export const CreateExpenseRequestSchema = z
  .object({
    property_id: z.uuid(),
    room_id: z.uuid().nullable().optional(),
    expense_type: ExpenseTypeSchema,
    description: z.string().max(500).optional(),
    amount_vnd: MoneyVndSchema.nonnegative(),
    expense_date: z.iso.date(),
    due_date: z.iso.date().optional(),
    is_recurring: z.boolean().optional().default(false),
    recurrence_pattern: RecurrencePatternSchema.optional(),
    is_paid: z.boolean().optional().default(false),
    paid_at: z.iso.datetime().optional(),
    receipt_url: z.string().max(2048).optional(),
  })
  .refine((d) => d.expense_type !== 'OTA_COMMISSION', {
    message: 'OTA_COMMISSION do hệ thống tự sinh khi check-out, không nhập tay',
    path: ['expense_type'],
  })
  .refine((d) => !d.is_recurring || d.recurrence_pattern != null, {
    message: 'Chi phí định kỳ cần recurrence_pattern',
    path: ['recurrence_pattern'],
  });
export type CreateExpenseRequest = z.infer<typeof CreateExpenseRequestSchema>;

/** PATCH — trường mô tả/thanh toán; không đổi loại/cấu trúc định kỳ. */
export const UpdateExpenseRequestSchema = z
  .object({
    room_id: z.uuid().nullable(),
    description: z.string().max(500).nullable(),
    amount_vnd: MoneyVndSchema.nonnegative(),
    expense_date: z.iso.date(),
    due_date: z.iso.date().nullable(),
    is_paid: z.boolean(),
    paid_at: z.iso.datetime().nullable(),
    receipt_url: z.string().max(2048).nullable(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'Cần ít nhất một trường để cập nhật' });
export type UpdateExpenseRequest = z.infer<typeof UpdateExpenseRequestSchema>;

export const ExpenseResponseSchema = z.object({
  id: z.uuid(),
  property_id: z.uuid(),
  room_id: z.uuid().nullable(),
  expense_type: z.string(),
  description: z.string().nullable(),
  amount_vnd: MoneyVndSchema,
  expense_date: z.string(), // YYYY-MM-DD
  due_date: z.string().nullable(),
  is_recurring: z.boolean(),
  recurrence_pattern: z.string().nullable(),
  parent_expense_id: z.uuid().nullable(),
  source_booking_id: z.uuid().nullable(),
  is_paid: z.boolean(),
  paid_at: z.iso.datetime().nullable(),
  receipt_url: z.string().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type ExpenseResponse = z.infer<typeof ExpenseResponseSchema>;

/** Kết quả 1 lần sinh chi phí định kỳ theo kỳ tháng (cho night-audit + test). */
export const RecurringExpenseRunResultSchema = z.object({
  period_year: z.number().int(),
  period_month: z.number().int(),
  templates_considered: z.number().int(),
  expenses_created: z.number().int(),
});
export type RecurringExpenseRunResult = z.infer<typeof RecurringExpenseRunResultSchema>;
