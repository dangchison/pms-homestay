/**
 * Quy đổi basis point ↔ phần trăm cho tầng hiển thị.
 *
 * Toàn hệ dùng basis point (10000 = 100%) cho MỌI giá trị phần trăm:
 * `rate_plans.deposit_value` khi PERCENT, `rate_plan_rules.price_modifier_value`
 * khi PERCENT, `discount_codes.discount_value` khi PERCENT, và
 * `properties.landlord_revenue_share_bp`. Engine giá chia /10_000
 * (packages/pricing-engine: builder.ts, rules.ts).
 *
 * Người dùng luôn nhập và đọc theo phần trăm — quy đổi CHỈ ở biên giao diện,
 * không rải Number(x)/100 khắp component.
 */

/** Basis point cho 100% — cùng hằng số với PERCENT_BP_DIVISOR ở BE. */
export const BP_PER_UNIT = 10_000;

const BP_PER_PERCENT = BP_PER_UNIT / 100;

/** 3000 → 30. Giữ tối đa 2 chữ số thập phân (25 bp = 0.25%). */
export function bpToPercent(bp: number): number {
  return Math.round((bp / BP_PER_PERCENT) * 100) / 100;
}

/** 30 → 3000. Làm tròn về số nguyên vì cột DB là integer. */
export function percentToBp(percent: number): number {
  return Math.round(percent * BP_PER_PERCENT);
}

/**
 * 'YYYY-MM-DD' theo giờ ĐỊA PHƯƠNG cho <input type="date">.
 *
 * KHÔNG dùng `toISOString().slice(0,10)` cho ngày lịch: nó quy về UTC nên ở múi giờ
 * Việt Nam (UTC+7) trả về ngày hôm trước với mọi thời điểm trước 07:00 sáng.
 */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const VND = new Intl.NumberFormat('vi-VN');

/** 1050000 → "1.050.000 ₫". */
export function formatVnd(amount: number): string {
  return `${VND.format(amount)} ₫`;
}

/** Mô tả chính sách cọc thành một chuỗi đọc được cho bảng danh sách. */
export function describeDeposit(type: 'NONE' | 'FIXED' | 'PERCENT', value: number): string {
  if (type === 'NONE') return 'Không cọc';
  if (type === 'PERCENT') return `${bpToPercent(value)}%`;
  return formatVnd(value);
}
