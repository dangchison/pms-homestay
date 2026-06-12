import { z } from 'zod';
import { MoneyVndSchema } from './common';

/** Phương pháp khấu hao — MVP chỉ đường thẳng (docs/09 §7). */
export const DepreciationMethodSchema = z.enum(['STRAIGHT_LINE']);
export type DepreciationMethod = z.infer<typeof DepreciationMethodSchema>;

/**
 * Tạo tài sản. Tham số tài chính (nguyên giá, ngày mua, số tháng, giá trị còn
 * lại, phương pháp) là BẤT BIẾN sau khi tạo — sửa sẽ làm lệch sổ khấu hao đã
 * sinh; muốn đổi thì xoá (soft-delete) + tạo lại. PATCH chỉ sửa trường mô tả.
 */
export const CreateAssetRequestSchema = z
  .object({
    property_id: z.uuid(),
    room_id: z.uuid().nullable().optional(), // null/bỏ trống = khu vực chung
    name: z.string().min(1).max(255),
    category: z.string().max(64).optional(), // FURNITURE, ELECTRONICS,...
    serial_number: z.string().max(100).optional(),
    purchase_value_vnd: MoneyVndSchema.nonnegative(), // nguyên giá
    purchase_date: z.iso.date(),
    depreciation_method: DepreciationMethodSchema.default('STRAIGHT_LINE'),
    depreciation_months: z.number().int().min(1).max(1200), // ≤ 100 năm
    residual_value_vnd: MoneyVndSchema.nonnegative().default(0),
    notes: z.string().optional(),
    photo_url: z.string().max(2048).optional(),
  })
  .refine((d) => d.residual_value_vnd <= d.purchase_value_vnd, {
    message: 'Giá trị còn lại không được vượt nguyên giá',
    path: ['residual_value_vnd'],
  });
export type CreateAssetRequest = z.infer<typeof CreateAssetRequestSchema>;

/** PATCH — chỉ trường mô tả (không đụng tham số tài chính, xem ghi chú create). */
export const UpdateAssetRequestSchema = z
  .object({
    room_id: z.uuid().nullable(),
    name: z.string().min(1).max(255),
    category: z.string().max(64).nullable(),
    serial_number: z.string().max(100).nullable(),
    notes: z.string().nullable(),
    photo_url: z.string().max(2048).nullable(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'Cần ít nhất một trường để cập nhật' });
export type UpdateAssetRequest = z.infer<typeof UpdateAssetRequestSchema>;

/** Thanh lý tài sản giữa kỳ — dừng sinh khấu hao từ kỳ sau (docs/09 §7). */
export const DisposeAssetRequestSchema = z.object({
  disposal_date: z.iso.date(),
  disposal_value_vnd: MoneyVndSchema.nonnegative(),
});
export type DisposeAssetRequest = z.infer<typeof DisposeAssetRequestSchema>;

export const AssetResponseSchema = z.object({
  id: z.uuid(),
  property_id: z.uuid(),
  room_id: z.uuid().nullable(),
  name: z.string(),
  category: z.string().nullable(),
  serial_number: z.string().nullable(),
  purchase_value_vnd: MoneyVndSchema,
  purchase_date: z.string(), // YYYY-MM-DD
  depreciation_method: z.string(),
  depreciation_months: z.number().int(),
  residual_value_vnd: MoneyVndSchema,
  disposal_date: z.string().nullable(),
  disposal_value_vnd: MoneyVndSchema.nullable(),
  notes: z.string().nullable(),
  photo_url: z.string().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type AssetResponse = z.infer<typeof AssetResponseSchema>;

/** Một dòng sổ khấu hao theo kỳ tháng. */
export const DepreciationEntryResponseSchema = z.object({
  id: z.uuid(),
  asset_id: z.uuid(),
  period_year: z.number().int(),
  period_month: z.number().int(),
  amount_vnd: MoneyVndSchema,
  accumulated_vnd: MoneyVndSchema,
  book_value_vnd: MoneyVndSchema,
  created_at: z.iso.datetime(),
});
export type DepreciationEntryResponse = z.infer<typeof DepreciationEntryResponseSchema>;

/** Kết quả 1 lần chạy khấu hao tháng (cho cron/night-audit + test). */
export const DepreciationRunResultSchema = z.object({
  period_year: z.number().int(),
  period_month: z.number().int(),
  assets_considered: z.number().int(),
  entries_created: z.number().int(),
});
export type DepreciationRunResult = z.infer<typeof DepreciationRunResultSchema>;
