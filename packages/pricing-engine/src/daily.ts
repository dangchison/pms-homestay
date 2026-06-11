import { buildQuote, line } from './builder';
import { addDays, dayOfWeek, diffCalendarDays } from './dateutil';
import { computeDatePrice } from './rules';
import { localDate, localTime } from './timezone';
import {
  PricingError,
  type PricingInput,
  type Quote,
  type QuoteLineItem,
  type RatePlanConfig,
} from './types';
import { type VietnamHoliday } from './holiday.types';

/**
 * Giá thuê theo NGÀY/ĐÊM (docs/07 §4). Mọi phép "rơi vào ngày nào / thứ mấy /
 * có phải lễ" tính theo timezone property. Số đêm = số ngày lịch (local) đi qua,
 * tối thiểu 1. Mỗi đêm áp rules theo NGÀY ĐÓ (weekend/holiday/season).
 */
export function quoteDaily(
  input: PricingInput,
  plan: RatePlanConfig,
  holidays: VietnamHoliday[],
): Quote {
  if (input.checkOut.getTime() <= input.checkIn.getTime()) {
    throw new PricingError('CHECKOUT_BEFORE_CHECKIN', 'check_out phải sau check_in');
  }

  const tz = plan.timezone;
  const ciDate = localDate(input.checkIn, tz);
  const coDate = localDate(input.checkOut, tz);
  const nights = Math.max(1, diffCalendarDays(ciDate, coDate));
  const holidaySet = new Set(holidays.map((h) => h.date));
  const rules = plan.rules ?? [];

  const items: QuoteLineItem[] = [];
  const nightDates: string[] = [];
  for (let i = 0; i < nights; i += 1) {
    const nightDate = addDays(ciDate, i);
    nightDates.push(nightDate);
    const price = computeDatePrice(
      plan.basePriceVnd,
      rules,
      nightDate,
      dayOfWeek(nightDate),
      holidaySet,
    );
    items.push(line('ROOM_CHARGE', `Đêm ${nightDate}`, 1, price, nightDate));
  }

  // Phụ phí nhận sớm / trả trễ — so sánh ĐẦY ĐỦ HH:mm theo giờ địa phương
  const localIn = localTime(input.checkIn, tz);
  const localOut = localTime(input.checkOut, tz);
  if (plan.dailyCheckinTime && localIn < plan.dailyCheckinTime && (plan.dailyEarlyCheckinFeeVnd ?? 0) > 0) {
    items.push(line('SURCHARGE', 'Nhận phòng sớm', 1, plan.dailyEarlyCheckinFeeVnd!));
  }
  if (plan.dailyCheckoutTime && localOut > plan.dailyCheckoutTime && (plan.dailyLateCheckoutFeeVnd ?? 0) > 0) {
    items.push(line('SURCHARGE', 'Trả phòng trễ', 1, plan.dailyLateCheckoutFeeVnd!));
  }

  const usedHolidays = holidays.filter((h) => nightDates.includes(h.date));
  return buildQuote({
    mode: 'DAILY',
    lineItems: items,
    depositType: plan.depositType,
    depositValue: plan.depositValue,
    holidays: usedHolidays,
  });
}
