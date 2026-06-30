import { z } from 'zod';

/** Loại cơ sở (docs/03 §2 enum property_type). */
export const PropertyTypeSchema = z.enum(['HOMESTAY', 'RENT_TO_RENT', 'APARTMENT', 'HOTEL']);
export type PropertyType = z.infer<typeof PropertyTypeSchema>;

/**
 * Trường cấu hình cơ sở dùng chung create/update (docs/03 §4.3).
 * KHÔNG dùng .default() ở đây — DB đã có DEFAULT; PATCH bỏ trống = giữ nguyên.
 */
const propertyFields = {
  name: z.string().min(1).max(255),
  property_type: PropertyTypeSchema,
  address_line: z.string().min(1).max(500),
  ward: z.string().max(100).optional(),
  district: z.string().max(100).optional(),
  province: z.string().min(1).max(100), // bắt buộc để báo cáo công an
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  timezone: z.string().min(1).max(64).optional(), // IANA tz; default DB 'Asia/Ho_Chi_Minh'
  is_rent_to_rent: z.boolean().optional(),
  landlord_name: z.string().max(255).optional(),
  landlord_phone: z.string().max(20).optional(),
  rent_to_rent_contract_start: z.iso.date().optional(),
  rent_to_rent_contract_end: z.iso.date().optional(),
  monthly_landlord_rent_vnd: z.number().int().nonnegative().optional(),
  // R2R chia % doanh thu (basis points, 10000=100%); set → ưu tiên mô hình share,
  // bỏ trống = dùng monthly_landlord_rent_vnd (thuê cố định). docs/16 #14.
  landlord_revenue_share_bp: z.number().int().min(0).max(10000).optional(),
  police_business_code: z.string().max(50).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
} as const;

export const CreatePropertyRequestSchema = z.object(propertyFields);
export type CreatePropertyRequest = z.infer<typeof CreatePropertyRequestSchema>;

/** PATCH: mọi trường optional (gửi cái nào sửa cái đó). */
export const UpdatePropertyRequestSchema = z.object(propertyFields).partial();
export type UpdatePropertyRequest = z.infer<typeof UpdatePropertyRequestSchema>;

/** Response cơ sở (BigInt/Decimal đã serialize sang number; *_at sang ISO). */
export const PropertyResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  property_type: PropertyTypeSchema,
  address_line: z.string(),
  ward: z.string().nullable(),
  district: z.string().nullable(),
  province: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  timezone: z.string(),
  is_rent_to_rent: z.boolean(),
  landlord_name: z.string().nullable(),
  landlord_phone: z.string().nullable(),
  rent_to_rent_contract_start: z.string().nullable(),
  rent_to_rent_contract_end: z.string().nullable(),
  monthly_landlord_rent_vnd: z.number().nullable(),
  landlord_revenue_share_bp: z.number().nullable(),
  police_business_code: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type PropertyResponse = z.infer<typeof PropertyResponseSchema>;
