import { z } from 'zod';

export const IdDocumentTypeSchema = z.enum(['CCCD', 'CMND', 'PASSPORT']);
export type IdDocumentType = z.infer<typeof IdDocumentTypeSchema>;

/** Trường khách dùng chung create/update (PII số giấy tờ nhận plaintext, mã hoá server-side). */
const guestFields = {
  full_name: z.string().min(1).max(255),
  phone: z.string().max(20).optional(),
  email: z.email().optional(),
  nationality: z.string().length(2).optional(), // ISO-2; default DB 'VN'
  id_document_type: IdDocumentTypeSchema.optional(),
  id_document_number: z.string().min(4).max(32).optional(), // plaintext vào, KHÔNG bao giờ trả lại ở list/get
  id_document_issue_date: z.iso.date().optional(),
  id_document_issue_place: z.string().max(255).optional(),
  id_document_scan_url: z.string().max(1024).optional(), // key ảnh scan trên storage tier VN (task 7.1)
  date_of_birth: z.iso.date().optional(),
  gender: z.string().max(10).optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
} as const;

export const CreateGuestRequestSchema = z.object(guestFields);
export type CreateGuestRequest = z.infer<typeof CreateGuestRequestSchema>;

export const UpdateGuestRequestSchema = z
  .object(guestFields)
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'Cần ít nhất một trường để cập nhật' });
export type UpdateGuestRequest = z.infer<typeof UpdateGuestRequestSchema>;

export const BlacklistGuestRequestSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type BlacklistGuestRequest = z.infer<typeof BlacklistGuestRequestSchema>;

/** Response khách — số giấy tờ CHỈ hiển thị ****last4 (xem đầy đủ qua endpoint riêng). */
export const GuestResponseSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  nationality: z.string().nullable(),
  id_document_type: z.string().nullable(),
  id_document_last4: z.string().nullable(),
  id_document_masked: z.string().nullable(), // '****1234'
  id_document_issue_date: z.string().nullable(),
  id_document_issue_place: z.string().nullable(),
  id_document_scan_url: z.string().nullable(),
  date_of_birth: z.string().nullable(),
  gender: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  is_blacklisted: z.boolean(),
  blacklist_reason: z.string().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type GuestResponse = z.infer<typeof GuestResponseSchema>;

/** Response xem số giấy tờ ĐẦY ĐỦ (endpoint riêng, decrypt + audit READ_PII). */
export const GuestIdDocumentResponseSchema = z.object({
  id: z.uuid(),
  id_document_type: z.string().nullable(),
  id_document_number: z.string(),
});
export type GuestIdDocumentResponse = z.infer<typeof GuestIdDocumentResponseSchema>;

/**
 * Tín hiệu danh tính TOÀN CỤC của khách (Phase 3, docs/16 — tầng `persons`). CHỈ
 * nhận diện, KHÔNG lộ PII cross-tenant: chủ hiện tại biết khách quen / bị blacklist
 * ở nơi khác mà KHÔNG thấy dữ liệu/booking/lý-do của chủ khác.
 */
export const GuestPlatformSummaryResponseSchema = z.object({
  linked: z.boolean(), // guest đã gắn person (có số giấy tờ) chưa
  is_returning_guest: z.boolean(), // person xuất hiện ở ≥2 tenant (đã ở chủ khác)
  blacklisted_elsewhere: z.boolean(), // bị blacklist ở tenant khác (không phải chủ hiện tại)
});
export type GuestPlatformSummaryResponse = z.infer<typeof GuestPlatformSummaryResponseSchema>;

/** OCR CCCD (task 7.1, docs/12 §3) — pre-sign upload ảnh lên storage tier VN. */
export const IdScanPresignRequestSchema = z.object({
  side: z.enum(['front', 'back']),
  content_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
});
export type IdScanPresignRequest = z.infer<typeof IdScanPresignRequestSchema>;

export const IdScanPresignResponseSchema = z.object({
  key: z.string(),
  upload_url: z.string(),
  expires_in: z.number().int(),
});
export type IdScanPresignResponse = z.infer<typeof IdScanPresignResponseSchema>;

/** Scan CCCD/hộ chiếu qua OCR → trả extracted để prefill form. KHÔNG ghi DB ở bước này. */
export const ScanIdRequestSchema = z.object({
  image_key: z.string().min(1).max(1024), // key ảnh đã upload (từ presign)
});
export type ScanIdRequest = z.infer<typeof ScanIdRequestSchema>;

/** Extracted OCR — toàn bộ nullable (OCR có thể thiếu trường); raw response KHÔNG trả/lưu. */
export const ScanIdResponseSchema = z.object({
  document_type: z.string().nullable(), // CCCD | CMND | PASSPORT
  document_number: z.string().nullable(),
  full_name: z.string().nullable(),
  date_of_birth: z.string().nullable(), // ISO date
  gender: z.string().nullable(),
  nationality: z.string().nullable(),
  issue_date: z.string().nullable(), // ISO date
  issue_place: z.string().nullable(),
  address: z.string().nullable(),
});
export type ScanIdResponse = z.infer<typeof ScanIdResponseSchema>;
