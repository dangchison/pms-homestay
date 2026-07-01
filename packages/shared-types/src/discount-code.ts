import { z } from 'zod';

/**
 * Mã giảm giá / khuyến mãi (discount_codes) — Wave-1 #4, docs/07 §7. Voucher áp
 * vào BÁO GIÁ (quote) khi tạo booking: FIXED (giảm tiền cố định, VND) hoặc PERCENT
 * (giảm % theo basis-point 0..10000 — 10000 = 100%, cùng quy ước rate_plan_rules
 * PERCENT & properties.landlord_revenue_share_bp).
 *
 * discount_value ĐA NGHĨA theo discount_type → refine cross-field bên dưới phải
 * ĐỒNG BỘ y hệt CHECK discount_codes_value_by_type ở migration 0032:
 *   FIXED   ⇒ discount_value ≥ 1 (VND)
 *   PERCENT ⇒ discount_value 0..10000 (basis-point)
 * Mục đích: FE/BE fail sớm trước khi chạm DB.
 */

/** Loại giảm giá — tập ĐÓNG, khớp native ENUM discount_type (0032). */
export const DiscountTypeSchema = z.enum(['FIXED', 'PERCENT']);
export type DiscountType = z.infer<typeof DiscountTypeSchema>;

/** Giới hạn basis-point cho PERCENT (10000 = 100%). */
const PERCENT_BP_MAX = 10_000;

/**
 * Trường dùng chung Create/Update. code + discount_type + discount_value là lõi;
 * các trường còn lại optional. Ràng buộc cross-field (PERCENT/FIXED, valid window)
 * áp ở discountCodeFields (đã refine) và ở Create/Update.
 */
const discountCodeBase = z.object({
  /** mã voucher (so khớp KHÔNG phân biệt hoa/thường ở DB — CITEXT) */
  code: z.string().min(1).max(64),
  discount_type: DiscountTypeSchema,
  /** FIXED: số tiền VND (≥1); PERCENT: basis-point 0..10000 (xem refine) */
  discount_value: z.number().int(),
  /** giá trị đơn tối thiểu để áp mã (VND) */
  min_order_vnd: z.number().int().min(0).optional(),
  /** số lượt tối đa; null = không giới hạn */
  max_uses: z.number().int().min(0).nullable().optional(),
  valid_from: z.iso.datetime().nullable().optional(),
  valid_to: z.iso.datetime().nullable().optional(),
  /** danh sách cơ sở áp dụng; null = MỌI cơ sở (KHÁC mảng rỗng) */
  applicable_property_ids: z.array(z.uuid()).nullable().optional(),
  is_active: z.boolean().optional(),
});

/**
 * Ràng buộc chung cho miền dữ liệu discount (đồng bộ CHECK 0032):
 *  - PERCENT ⇒ discount_value 0..10000; FIXED ⇒ discount_value ≥ 1
 *  - nếu đủ cả valid_from & valid_to thì from ≤ to
 */
const refineDiscountValue = (
  d: { discount_type: DiscountType; discount_value: number },
): boolean =>
  d.discount_type === 'PERCENT'
    ? d.discount_value >= 0 && d.discount_value <= PERCENT_BP_MAX
    : d.discount_value >= 1;

const refineValidWindow = (d: {
  valid_from?: string | null;
  valid_to?: string | null;
}): boolean => !d.valid_from || !d.valid_to || d.valid_from <= d.valid_to;

/** Object schema dùng chung (đã refine cross-field) — cho FE build form/validate. */
export const discountCodeFields = discountCodeBase
  .refine(refineDiscountValue, {
    message: 'PERCENT: discount_value trong 0..10000 (basis-point); FIXED: ≥ 1 (VND)',
    path: ['discount_value'],
  })
  .refine(refineValidWindow, {
    message: 'valid_from phải ≤ valid_to',
    path: ['valid_to'],
  });

/** Tạo mã: code + discount_type + discount_value bắt buộc; các trường khác optional. */
export const CreateDiscountCodeRequestSchema = discountCodeBase
  .refine(refineDiscountValue, {
    message: 'PERCENT: discount_value trong 0..10000 (basis-point); FIXED: ≥ 1 (VND)',
    path: ['discount_value'],
  })
  .refine(refineValidWindow, {
    message: 'valid_from phải ≤ valid_to',
    path: ['valid_to'],
  });
export type CreateDiscountCodeRequest = z.infer<typeof CreateDiscountCodeRequestSchema>;

/**
 * Cập nhật mã — MỌI trường optional (kể cả discount_type/discount_value/code),
 * cần ít nhất một trường (giống UpdateForeignResidenceRequestSchema). Nếu đổi
 * discount_type/discount_value thì phải cung cấp CẶP để refine kiểm được (service
 * merge với bản ghi hiện có khi chỉ đổi một trong hai).
 */
export const UpdateDiscountCodeRequestSchema = discountCodeBase
  .partial()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Cần ít nhất một trường để cập nhật',
  })
  .refine(
    (d) =>
      d.discount_type === undefined || d.discount_value === undefined
        ? true
        : refineDiscountValue({
            discount_type: d.discount_type,
            discount_value: d.discount_value,
          }),
    {
      message: 'PERCENT: discount_value trong 0..10000 (basis-point); FIXED: ≥ 1 (VND)',
      path: ['discount_value'],
    },
  )
  .refine(refineValidWindow, {
    message: 'valid_from phải ≤ valid_to',
    path: ['valid_to'],
  });
export type UpdateDiscountCodeRequest = z.infer<typeof UpdateDiscountCodeRequestSchema>;

/**
 * Response phản chiếu ĐỦ cột bảng (KHÔNG lộ tenant_id/deleted_at). Money là number
 * (Prisma đọc BigInt → Number ở tầng service). Thời điểm là chuỗi ISO.
 */
export const DiscountCodeResponseSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  discount_type: DiscountTypeSchema,
  discount_value: z.number(),
  min_order_vnd: z.number(),
  max_uses: z.number().nullable(),
  used_count: z.number(),
  valid_from: z.string().nullable(),
  valid_to: z.string().nullable(),
  applicable_property_ids: z.array(z.uuid()).nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type DiscountCodeResponse = z.infer<typeof DiscountCodeResponseSchema>;
