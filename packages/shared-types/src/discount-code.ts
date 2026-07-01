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
export const refineDiscountValue = (
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

/**
 * Mã lý do kết quả applyDiscount (task 9.4b, docs/07 §7) — 1 nhánh / lý do để FE
 * hiện thông báo phù hợp. 'OK' là nhánh DUY NHẤT hợp lệ (valid:true); còn lại đều
 * valid:false, discount_vnd:0:
 *   NOT_FOUND              — mã không tồn tại hoặc đã soft-delete
 *   INACTIVE              — is_active = false
 *   NOT_STARTED           — now < valid_from
 *   EXPIRED               — now > valid_to
 *   BELOW_MIN_ORDER       — subtotal < min_order_vnd
 *   PROPERTY_NOT_ELIGIBLE — applicable_property_ids != NULL và KHÔNG chứa property_id
 *                           (mảng rỗng [] → không property nào hợp lệ)
 *   USAGE_LIMIT_REACHED   — max_uses != NULL và used_count >= max_uses
 * Biên: now == valid_from và now == valid_to đều HỢP LỆ (closed interval).
 */
export const ApplyDiscountReasonCodeSchema = z.enum([
  'OK',
  'NOT_FOUND',
  'INACTIVE',
  'NOT_STARTED',
  'EXPIRED',
  'BELOW_MIN_ORDER',
  'PROPERTY_NOT_ELIGIBLE',
  'USAGE_LIMIT_REACHED',
]);
export type ApplyDiscountReasonCode = z.infer<typeof ApplyDiscountReasonCodeSchema>;

/**
 * Kết quả áp mã (applyDiscount). discount_vnd là số tiền giảm ĐÃ làm tròn (roundVnd,
 * VND), luôn 0 khi valid:false. FIXED bị "cap" theo subtotal (không âm total);
 * PERCENT = roundVnd(subtotal * discount_value / 10000) (basis-point, half-away-from-zero).
 */
export const ApplyDiscountResultSchema = z.object({
  valid: z.boolean(),
  discount_vnd: z.number(),
  reason_code: ApplyDiscountReasonCodeSchema,
});
export type ApplyDiscountResult = z.infer<typeof ApplyDiscountResultSchema>;

/**
 * Query cho GET /discount-codes/:code/validate (task 9.4c) — FE pre-check trước khi báo giá.
 * subtotal_vnd đến từ query-string (chuỗi) → z.coerce.number ép sang int TRƯỚC khi applyDiscount
 * (nên ?subtotal_vnd=200000 chạy). Thiếu / âm subtotal_vnd → 400; property_id không phải uuid → 400.
 * Endpoint trả 200 kèm reason_code (kể cả NOT_FOUND) — KHÔNG 404 — để an toàn cho FE dùng làm gate.
 */
export const DiscountValidateQuerySchema = z.object({
  subtotal_vnd: z.coerce.number().int().min(0),
  property_id: z.uuid(),
});
export type DiscountValidateQuery = z.infer<typeof DiscountValidateQuerySchema>;
