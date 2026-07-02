import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type ScanIdResponse } from '@pms/shared-types';
import { type FptOcrRaw } from '../ocr.service';
import { type OcrProvider } from './ocr-provider';

/** Họ + tên đệm + tên (VN) để dựng full_name tất định từ hash. */
const SURNAMES = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng'];
const MIDDLE_NAMES = ['Văn', 'Thị', 'Hữu', 'Đức', 'Ngọc', 'Minh', 'Thanh', 'Quang'];
const GIVEN_NAMES = ['An', 'Bình', 'Cường', 'Dũng', 'Hà', 'Hương', 'Lan', 'Nam', 'Phúc', 'Quân', 'Trang', 'Yến'];
const GENDERS = ['NAM', 'NỮ'];
const ISSUE_PLACES = [
  'Cục Cảnh sát ĐKQL cư trú và DLQG về dân cư',
  'Công an TP. Hà Nội',
  'Công an TP. Hồ Chí Minh',
  'Công an TP. Đà Nẵng',
];
const PROVINCES = ['Hà Nội', 'TP. Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ', 'Huế'];

/**
 * ★ MockOcrProvider (Đợt 4 / M3, docs/18) — sandbox OCR CCCD: sinh dữ liệu CCCD
 * DETERMINISTIC từ SHA-256(image_key) để dev/CI chạy end-to-end mà KHÔNG cần
 * credentials FPT.AI. Dùng khi OCR_PROVIDER='mock' (mặc định 'auto' → FptOcrProvider,
 * KHÔNG bao giờ tự bật mock ở prod). KHÔNG I/O ngoài (KHÔNG StorageService.getObject),
 * KHÔNG ghi DB (ADR-0007 — chỉ prefill, giống FptOcrProvider). Trả đúng shape
 * ScanIdResponse (dob/issue_date match /^\d{4}-\d{2}-\d{2}$/).
 *
 * Trade-off thiết kế (proxy CEO): hash `image_key` chứ KHÔNG hash bytes ảnh — nên
 * cùng ảnh vật lý upload lại (presign random → key mới) sẽ ra doc_number KHÁC. Chọn
 * hash key vì (a) giữ e2e hermetic KHÔNG cần S3 thật (nhất quán convention không
 * overrideProvider), (b) demo person-identity 9.2 vẫn đạt: tái dùng CÙNG image_key
 * giữa 2 tenant → cùng doc_number → cùng person qua blind index. Collision doc_number
 * (12 digit từ hash) xác suất cực nhỏ nhưng khác 0 — chấp nhận cho mock/demo, KHÔNG prod.
 */
@Injectable()
export class MockOcrProvider implements OcrProvider {
  readonly name = 'mock';

  // Seam opts.rawOcr giữ đồng chữ ký OcrProvider; mock tất định KHÔNG dùng HTTP nên bỏ qua.
  scan(imageKey: string, _opts?: { rawOcr?: FptOcrRaw }): Promise<ScanIdResponse> {
    const hash = createHash('sha256').update(imageKey).digest('hex'); // 64 hex chars

    const documentNumber = this.deriveDocumentNumber(hash);
    const surname = pick(hash, 0, SURNAMES);
    const middle = pick(hash, 2, MIDDLE_NAMES);
    const given = pick(hash, 4, GIVEN_NAMES);

    return Promise.resolve({
      document_type: 'CCCD',
      document_number: documentNumber,
      full_name: `${surname} ${middle} ${given}`,
      // dob: 1960–1999 (tuổi hợp lệ cho khách lưu trú), tháng/ngày an toàn (1–28).
      date_of_birth: this.deriveDate(hash, 6, 1960, 40),
      gender: pick(hash, 12, GENDERS),
      nationality: 'VN',
      // issue_date: 2016–2023 (khoảng cấp CCCD gắn chip), tháng/ngày an toàn.
      issue_date: this.deriveDate(hash, 14, 2016, 8),
      issue_place: pick(hash, 20, ISSUE_PLACES),
      address: `Số ${1 + hexByte(hash, 22) % 200} P. Mẫu, ${pick(hash, 24, PROVINCES)}`,
    });
  }

  /** 12 chữ số tất định: BigInt(hash-hex) mod 10^12, pad trái '0' đủ 12 ký tự. */
  private deriveDocumentNumber(hash: string): string {
    const n = BigInt(`0x${hash}`) % 1_000_000_000_000n;
    return n.toString().padStart(12, '0');
  }

  /**
   * ISO date 'yyyy-mm-dd' tất định từ hash tại `offset`. year ∈ [baseYear, baseYear+span);
   * month 1–12; day 1–28 (an toàn mọi tháng, không tạo ngày không hợp lệ). Luôn match
   * /^\d{4}-\d{2}-\d{2}$/.
   */
  private deriveDate(hash: string, offset: number, baseYear: number, span: number): string {
    const year = baseYear + (hexByte(hash, offset) % span);
    const month = 1 + (hexByte(hash, offset + 2) % 12);
    const day = 1 + (hexByte(hash, offset + 4) % 28);
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }
}

/** 1 byte (0–255) từ 2 ký tự hex của hash tại vị trí `pos` (đầu ký tự). */
function hexByte(hash: string, pos: number): number {
  return parseInt(hash.slice(pos, pos + 2), 16);
}

/** Chọn tất định 1 phần tử của `arr` từ byte hash tại `pos`. */
function pick<T>(hash: string, pos: number, arr: readonly T[]): T {
  return arr[hexByte(hash, pos) % arr.length] as T;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}
