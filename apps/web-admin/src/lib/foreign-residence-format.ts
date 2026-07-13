import type { ForeignResidenceStatus } from '@pms/shared-types';

/**
 * Định dạng khai báo tạm trú khách nước ngoài (NA17) — task 2.8 (docs/19 §3 Đợt 2).
 *
 * ⚠️ PII (BẮT BUỘC): số thị thực/hộ chiếu CHỈ được hiện tối đa 4 số cuối. BE (Response)
 * chỉ trả `visa_number_last4` (≤4 ký tự) — FE KHÔNG BAO GIỜ nhận số đầy đủ. `visaMask`
 * còn kẹp cứng `slice(-4)` như lưới phòng thủ: dù truyền cả số vào cũng chỉ lộ 4 ký tự
 * cuối → không nhánh nào phát ra >4 chữ số. Được unit-test ở foreign-residence-format.test.ts.
 */

/** Ký tự che (4 chấm) đứng trước 4 số cuối. */
const MASK_PREFIX = '••••';
/** Giá trị hiển thị khi thiếu dữ liệu. */
const DASH = '—';

/**
 * Che số thị thực/hộ chiếu: chỉ lộ tối đa 4 ký tự cuối (vd '0421' → '••••0421').
 * null/rỗng → '—'. `slice(-4)` kẹp cứng để KHÔNG nhánh nào lộ >4 chữ số kể cả khi
 * (sai sót) nhận cả số — PII-safe theo yêu cầu task 2.8.
 */
export function visaMask(last4: string | null | undefined): string {
  if (last4 == null) return DASH;
  const tail = String(last4).slice(-4);
  if (tail.length === 0) return DASH;
  return `${MASK_PREFIX}${tail}`;
}

/** Nhãn tiếng Việt cho trạng thái khai báo. */
export const FOREIGN_RESIDENCE_STATUS_LABEL: Record<ForeignResidenceStatus, string> = {
  DRAFT: 'Nháp',
  SUBMITTED: 'Đã gửi',
  FAILED: 'Gửi lỗi',
};

export function foreignResidenceStatusLabel(status: ForeignResidenceStatus): string {
  return FOREIGN_RESIDENCE_STATUS_LABEL[status] ?? status;
}

/** Biến thể Badge theo trạng thái: SUBMITTED=secondary, FAILED=destructive, DRAFT=outline. */
export function foreignResidenceStatusVariant(
  status: ForeignResidenceStatus,
): 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'SUBMITTED':
      return 'secondary';
    case 'FAILED':
      return 'destructive';
    default:
      return 'outline';
  }
}

/** Nhãn loại thị thực: 'EXEMPT' → 'Miễn thị thực'; null/rỗng → '—'; còn lại giữ mã. */
export function visaTypeLabel(visaType: string | null | undefined): string {
  if (!visaType) return DASH;
  if (visaType === 'EXEMPT') return 'Miễn thị thực';
  return visaType;
}
