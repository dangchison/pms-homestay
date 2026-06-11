import { AppException } from '@core/http/exceptions/app.exception';

/**
 * Parse header If-Match → version number (docs/05 §4.5). Hỗ trợ cả dạng có/không
 * ngoặc kép (ETag). Thiếu → 428; sai → 400. Dùng cho PATCH entity có optimistic lock.
 */
export function parseIfMatch(raw: string | undefined): number {
  if (!raw) {
    throw new AppException({
      code: 'IF_MATCH_REQUIRED',
      title: 'PATCH cần header If-Match = version hiện tại',
      status: 428,
    });
  }
  const n = Number(raw.replace(/^W\//, '').replace(/"/g, '').trim());
  if (!Number.isInteger(n) || n < 0) {
    throw new AppException({ code: 'IF_MATCH_INVALID', title: 'If-Match không hợp lệ', status: 400 });
  }
  return n;
}
