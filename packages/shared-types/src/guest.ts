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
