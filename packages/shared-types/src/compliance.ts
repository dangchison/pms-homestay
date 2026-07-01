import { z } from 'zod';

/**
 * Báo cáo lưu trú công an (Thông tư 56) — task 7.2, docs/12 §2. Query theo property
 * + khoảng ngày check-in [from, to] (inclusive). Trả file Excel (binary, không JSON).
 */
export const PoliceReportQuerySchema = z
  .object({
    property_id: z.uuid(),
    from: z.iso.date(), // YYYY-MM-DD (theo ngày check-in)
    to: z.iso.date(),
  })
  .refine((q) => q.from <= q.to, { message: 'from phải ≤ to' });
export type PoliceReportQuery = z.infer<typeof PoliceReportQuerySchema>;

/**
 * POST /compliance/police-report/submit (B6, docs/12 §2 Phase 2) — "Gửi" khai báo
 * lưu trú lên dịch vụ công cho khách đã lưu trú trong [from, to]. Phase 2 thật =
 * POST API dịch vụ công cư trú cấp xã (hiện STUB: thiếu số giấy tờ → FAILED, có → SUBMITTED).
 */
export const SubmitPoliceReportRequestSchema = z
  .object({
    property_id: z.uuid(),
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine((q) => q.from <= q.to, { message: 'from phải ≤ to' });
export type SubmitPoliceReportRequest = z.infer<typeof SubmitPoliceReportRequestSchema>;

export const SubmitPoliceReportResponseSchema = z.object({
  total: z.number().int(), // số booking đã lưu trú trong kỳ
  submitted: z.number().int(), // chuyển sang SUBMITTED lần này
  failed: z.number().int(), // thiếu PII (số giấy tờ) → FAILED
  skipped: z.number().int(), // đã SUBMITTED trước đó → bỏ qua
});
export type SubmitPoliceReportResponse = z.infer<typeof SubmitPoliceReportResponseSchema>;

// ── Khai báo TẠM TRÚ khách NƯỚC NGOÀI (XNC, mẫu NA17) — task 9.3, docs/12 §2 ─
// Nghĩa vụ RIÊNG với khách nước ngoài (khai lên Cục Quản lý xuất nhập cảnh), KHÁC
// thông báo lưu trú công an TT56 (áp cho MỌI khách). Một khách NN cần CẢ HAI. Dữ
// liệu visa/nhập cảnh per-stay; số thị thực mã hoá field (chỉ trả last4 ở list/get).

export const ForeignResidenceStatusSchema = z.enum(['DRAFT', 'SUBMITTED', 'FAILED']);
export type ForeignResidenceStatus = z.infer<typeof ForeignResidenceStatusSchema>;

/** Trường NA17 dùng chung create/update — đều optional để lễ tân lưu nháp dần. */
const ForeignResidenceFieldsSchema = z.object({
  /** số thị thực (mã hoá field khi lưu); bỏ trống nếu miễn thị thực */
  visa_number: z.string().min(1).max(64).optional(),
  /** mã loại thị thực (DL/DN/LĐ/ĐT…) hoặc 'EXEMPT' khi được miễn */
  visa_type: z.string().min(1).max(32).optional(),
  visa_expiry: z.iso.date().optional(),
  date_of_entry: z.iso.date().optional(),
  port_of_entry: z.string().min(1).max(255).optional(),
  intended_departure: z.iso.date().optional(),
});

/** Tạo khai báo cho 1 booking (guest chính) — property_id/guest_id suy từ booking. */
export const CreateForeignResidenceRequestSchema = ForeignResidenceFieldsSchema.extend({
  booking_id: z.uuid(),
});
export type CreateForeignResidenceRequest = z.infer<typeof CreateForeignResidenceRequestSchema>;

/** Cập nhật (chỉ khi CHƯA SUBMITTED) — cần ít nhất một trường. */
export const UpdateForeignResidenceRequestSchema = ForeignResidenceFieldsSchema.refine(
  (d) => Object.keys(d).length > 0,
  { message: 'Cần ít nhất một trường để cập nhật' },
);
export type UpdateForeignResidenceRequest = z.infer<typeof UpdateForeignResidenceRequestSchema>;

/** Lọc danh sách theo cơ sở (+ trạng thái tuỳ chọn). */
export const ForeignResidenceListQuerySchema = z.object({
  property_id: z.uuid(),
  status: ForeignResidenceStatusSchema.optional(),
});
export type ForeignResidenceListQuery = z.infer<typeof ForeignResidenceListQuerySchema>;

/** Response — số thị thực CHỈ trả last4 (masked); không bao giờ lộ số đầy đủ. */
export const ForeignResidenceResponseSchema = z.object({
  id: z.uuid(),
  booking_id: z.uuid(),
  guest_id: z.uuid(),
  property_id: z.uuid(),
  visa_number_last4: z.string().nullable(),
  visa_type: z.string().nullable(),
  visa_expiry: z.string().nullable(),
  date_of_entry: z.string().nullable(),
  port_of_entry: z.string().nullable(),
  intended_departure: z.string().nullable(),
  status: ForeignResidenceStatusSchema,
  submitted_at: z.string().nullable(),
  xnc_reference: z.string().nullable(),
  failure_reason: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ForeignResidenceResponse = z.infer<typeof ForeignResidenceResponseSchema>;

/** Kết quả "Gửi" khai báo lên XNC (Phase 1 = STUB: đủ dữ liệu → SUBMITTED, thiếu → FAILED). */
export const SubmitForeignResidenceResponseSchema = z.object({
  id: z.uuid(),
  status: ForeignResidenceStatusSchema,
  xnc_reference: z.string().nullable(),
  failure_reason: z.string().nullable(),
});
export type SubmitForeignResidenceResponse = z.infer<typeof SubmitForeignResidenceResponseSchema>;

// ── Nghị định 13 — quyền chủ thể dữ liệu (task 7.3, docs/12 §4) ──────────────

export const ConsentTypeSchema = z.enum(['BOOKING_PROCESS', 'MARKETING', 'ANALYTICS']);
export type ConsentType = z.infer<typeof ConsentTypeSchema>;

/** Ghi nhận đồng ý xử lý dữ liệu (NĐ13) — lưu full text + hash + IP/UA. */
export const GrantConsentRequestSchema = z.object({
  consent_type: ConsentTypeSchema,
  consent_text: z.string().min(1).max(20_000),
});
export type GrantConsentRequest = z.infer<typeof GrantConsentRequestSchema>;

export const ConsentResponseSchema = z.object({
  id: z.uuid(),
  guest_id: z.uuid(),
  consent_type: z.string(),
  consent_text_hash: z.string(),
  granted_at: z.iso.datetime(),
  revoked_at: z.string().nullable(),
});
export type ConsentResponse = z.infer<typeof ConsentResponseSchema>;

/** Sửa thông tin khách (Right to Rectification) — chỉ trường không nhạy cảm. */
export const DataCorrectionRequestSchema = z
  .object({
    full_name: z.string().min(1).max(255).optional(),
    phone: z.string().max(20).optional(),
    email: z.email().optional(),
    address: z.string().optional(),
    date_of_birth: z.iso.date().optional(),
    nationality: z.string().length(2).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Cần ít nhất một trường để sửa' });
export type DataCorrectionRequest = z.infer<typeof DataCorrectionRequestSchema>;

/** Kết quả ẩn danh (Right to Erasure) — kèm legal-hold nếu còn nghĩa vụ lưu trữ. */
export const DataErasureResponseSchema = z.object({
  anonymized: z.boolean(),
  legal_hold_until: z.string().nullable(), // YYYY-MM-DD nếu còn giữ số giấy tờ theo luật
  kept: z.array(z.string()), // các nhóm dữ liệu GIỮ lại do legal-hold (vd 'id_document')
});
export type DataErasureResponse = z.infer<typeof DataErasureResponseSchema>;
