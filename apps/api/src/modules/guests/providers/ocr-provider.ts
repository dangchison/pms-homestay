import { type ScanIdResponse } from '@pms/shared-types';
import { type FptOcrRaw } from '../ocr.service';

/**
 * ★ OcrProvider (Đợt 4 / M3, docs/18) — trừu tượng hoá nhà cung cấp OCR CCCD/hộ chiếu.
 * DI theo env OCR_PROVIDER (auto|fpt→FptOcrProvider; mock→MockOcrProvider) qua
 * OCR_PROVIDER_TOKEN. Đợt 4 chạy mock/sandbox — end-to-end KHÔNG cần credentials thật.
 *
 * `scan(imageKey)` trả extracted đã map (ScanIdResponse) để prefill form — KHÔNG persist
 * raw (ADR-0007, chứa toàn bộ PII). Seam `opts.rawOcr` cho test bypass HTTP (FptOcrProvider).
 * FptOcrRaw + ScanIdResponse tái dùng từ shared-types/ocr.service (KHÔNG đổi @pms/shared-types).
 */
export interface OcrProvider {
  /** Nhãn provider (fpt|mock) — quan sát/log; KHÔNG persist. */
  readonly name: string;
  /** Trích giấy tờ từ ảnh đã upload (image_key). `opts.rawOcr` = seam test (bỏ HTTP). */
  scan(imageKey: string, opts?: { rawOcr?: FptOcrRaw }): Promise<ScanIdResponse>;
}

/** Injection token cho OcrProvider được chọn theo env OCR_PROVIDER (guests.module factory). */
export const OCR_PROVIDER_TOKEN = Symbol('OCR_PROVIDER');
