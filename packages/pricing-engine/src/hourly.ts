import { buildQuote, line } from './builder';
import { addDays } from './dateutil';
import { localDate, localWallClock } from './timezone';
import {
  PricingError,
  type PricingInput,
  type Quote,
  type QuoteLineItem,
  type RatePlanConfig,
} from './types';
import { type VietnamHoliday } from './holiday.types';

/**
 * Đếm số CỬA SỔ ĐÊM mà khoảng ở giao cắt (docs/07 §3). So sánh trong khung
 * "giả UTC địa phương" (localWallClock) để không phải quy đổi local→UTC.
 * Cửa sổ [start, end) cuốn qua nửa đêm nếu end <= start (vd 22:00→06:00).
 */
function countOvernightWindows(
  checkIn: Date,
  checkOut: Date,
  start: string | undefined,
  end: string | undefined,
  tz: string,
): number {
  if (!start || !end) return 0;
  const ci = localWallClock(checkIn, tz).getTime();
  const co = localWallClock(checkOut, tz).getTime();
  const wraps = end <= start;
  const lastDate = localDate(checkOut, tz);
  let count = 0;
  let cursor = addDays(localDate(checkIn, tz), -1); // đêm có thể bắt đầu từ hôm trước
  while (cursor <= lastDate) {
    const winStart = new Date(`${cursor}T${start}:00.000Z`).getTime();
    const winEnd = new Date(`${wraps ? addDays(cursor, 1) : cursor}T${end}:00.000Z`).getTime();
    if (ci < winEnd && co > winStart) count += 1;
    cursor = addDays(cursor, 1);
  }
  return count;
}

/** Giá thuê theo GIỜ (docs/07 §3): gói base + block phụ trội + phụ thu đêm. */
export function quoteHourly(
  input: PricingInput,
  plan: RatePlanConfig,
  _holidays: VietnamHoliday[],
): Quote {
  const minutes = (input.checkOut.getTime() - input.checkIn.getTime()) / 60_000;
  if (minutes <= 0) {
    throw new PricingError('CHECKOUT_BEFORE_CHECKIN', 'check_out phải sau check_in');
  }

  const baseHours = plan.hourlyBaseHours ?? 0;
  const blockMinutes = plan.hourlyExtraBlockMinutes ?? 60;
  const extraMinutes = Math.max(0, minutes - baseHours * 60);
  const extraBlocks = blockMinutes > 0 ? Math.ceil(extraMinutes / blockMinutes) : 0;
  const extraBlockPrice = plan.hourlyExtraBlockPriceVnd ?? 0;

  const overnightCount = countOvernightWindows(
    input.checkIn,
    input.checkOut,
    plan.hourlyOvernightStart,
    plan.hourlyOvernightEnd,
    plan.timezone,
  );
  const overnightPrice = plan.hourlyOvernightSurchargeVnd ?? 0;

  const items: QuoteLineItem[] = [line('ROOM_CHARGE', `Gói ${baseHours}h cơ bản`, 1, plan.basePriceVnd)];
  if (extraBlocks > 0 && extraBlockPrice > 0) {
    items.push(line('SURCHARGE', `Thêm ${extraBlocks} block × ${blockMinutes} phút`, extraBlocks, extraBlockPrice));
  }
  if (overnightCount > 0 && overnightPrice > 0) {
    items.push(line('SURCHARGE', 'Phụ thu đêm', overnightCount, overnightPrice));
  }

  return buildQuote({
    mode: 'HOURLY',
    lineItems: items,
    depositType: plan.depositType,
    depositValue: plan.depositValue,
    holidays: [],
  });
}
