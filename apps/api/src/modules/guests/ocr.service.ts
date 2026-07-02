/**
 * ★ Nguyên thuỷ (task 7.1, docs/12 §3): OCR CCCD/hộ chiếu.
 *
 * Đợt 4 / M3 (docs/18): logic OcrService cũ đã TÁCH sang OcrProvider — toàn bộ FPT.AI
 * chuyển nguyên vẹn vào `providers/fpt-ocr.provider.ts` (FptOcrProvider). GuestsService
 * inject qua OCR_PROVIDER_TOKEN (factory chọn theo env OCR_PROVIDER: auto|fpt→FptOcrProvider,
 * mock→MockOcrProvider). File này GIỮ 2 primitive dùng chung (FptOcrRaw shape + parseVnDate)
 * để provider + test import từ một nguồn — KHÔNG đổi @pms/shared-types.
 */

/** Một mục data FPT.AI trả về (field tuỳ loại giấy tờ — đọc phòng thủ). */
export interface FptOcrRaw {
  errorCode?: number;
  errorMessage?: string;
  data?: Array<Record<string, unknown>>;
}

/** 'dd/mm/yyyy' (FPT.AI) → ISO 'yyyy-mm-dd'; không khớp → null. */
export function parseVnDate(s: string | null): string | null {
  if (!s) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
