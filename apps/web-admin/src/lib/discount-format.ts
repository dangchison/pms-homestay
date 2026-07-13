import type { ApplyDiscountReasonCode, DiscountType } from '@pms/shared-types';
import { vnd } from './format';

/**
 * Định dạng + đơn vị mã giảm giá (task 2.2, docs/19 §3 Đợt 2).
 *
 * ⚠️ ĐƠN VỊ PERCENT là điểm ĐÚNG-SAI cốt lõi: `discount_value` của PERCENT lưu dạng
 * BASIS-POINT (10000 = 100%, cùng quy ước PERCENT_BP_DIVISOR ở discounts.service +
 * rate_plan_rules PERCENT). Nên 1 % = 100 bp: hiển thị = bp/100 + '%'; nhập từ form % →
 * bp = Math.round(pct*100). Quên nhân/chia 100 → lệch 100 lần. FIXED giữ nguyên VND.
 */

/** Số basis-point cho 1% (1% = 100 bp; 100% = 10000 bp). */
const BP_PER_PERCENT = 100;

/** basis-point → phần trăm (1000 bp → 10). */
export function bpToPct(bp: number): number {
  return bp / BP_PER_PERCENT;
}

/** phần trăm → basis-point, làm tròn (10 → 1000; 7.5 → 750). */
export function pctToBp(pct: number): number {
  return Math.round(pct * BP_PER_PERCENT);
}

/**
 * Hiển thị giá trị mã theo loại: PERCENT → 'N%' (từ basis-point); FIXED → tiền VND (vnd()).
 * SUMMER10 (PERCENT, 1000) → '10%'; GIAM50K (FIXED, 50000) → '50.000₫'.
 */
export function formatDiscountValue(type: DiscountType, value: number): string {
  return type === 'PERCENT' ? `${bpToPct(value)}%` : vnd(value);
}

/**
 * Ánh xạ reason_code (detail của 422 DISCOUNT_NOT_APPLICABLE, xem pricing.service +
 * ApplyDiscountReasonCode) → thông điệp tiếng Việt hiển thị dưới ô mã. Phủ đủ 7 nhánh
 * fail + fallback cho reason lạ/thiếu (KHÔNG crash).
 */
const REASON_MESSAGE: Record<Exclude<ApplyDiscountReasonCode, 'OK'>, string> = {
  NOT_FOUND: 'Mã giảm giá không tồn tại.',
  INACTIVE: 'Mã giảm giá đã ngừng áp dụng.',
  NOT_STARTED: 'Mã giảm giá chưa tới ngày áp dụng.',
  EXPIRED: 'Mã giảm giá đã hết hạn.',
  BELOW_MIN_ORDER: 'Đơn chưa đạt giá trị tối thiểu để áp mã.',
  PROPERTY_NOT_ELIGIBLE: 'Mã không áp dụng cho cơ sở này.',
  USAGE_LIMIT_REACHED: 'Mã đã hết lượt sử dụng.',
};

export function discountReasonMessage(reason: string | undefined | null): string {
  if (reason && reason in REASON_MESSAGE) {
    return REASON_MESSAGE[reason as Exclude<ApplyDiscountReasonCode, 'OK'>];
  }
  return 'Mã giảm giá không áp dụng được.';
}
