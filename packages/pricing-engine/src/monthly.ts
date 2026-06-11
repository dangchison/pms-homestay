import { buildQuote, line } from './builder';
import { addMonths, diffCalendarDays, fullMonthsBetween } from './dateutil';
import { roundVnd } from './round';
import { localDate } from './timezone';
import {
  PricingError,
  type PricingInput,
  type Quote,
  type QuoteLineItem,
  type RatePlanConfig,
} from './types';
import { type VietnamHoliday } from './holiday.types';

/**
 * Giá thuê theo THÁNG (docs/07 §5): N tháng trọn + ngày lẻ × (base/30).
 * Quy ước /30 cố định bất kể tháng 28–31 ngày. Quote chỉ là báo giá kỳ đầu —
 * điện/nước thực tế do job billing-cycle xuất hằng tháng (docs/09 §4.5).
 */
export function quoteMonthly(
  input: PricingInput,
  plan: RatePlanConfig,
  _holidays: VietnamHoliday[],
): Quote {
  if (input.checkOut.getTime() <= input.checkIn.getTime()) {
    throw new PricingError('CHECKOUT_BEFORE_CHECKIN', 'check_out phải sau check_in');
  }

  const tz = plan.timezone;
  const ciDate = localDate(input.checkIn, tz);
  const coDate = localDate(input.checkOut, tz);
  const months = fullMonthsBetween(ciDate, coDate);
  const partialDays = diffCalendarDays(addMonths(ciDate, months), coDate);
  const dayRate = roundVnd(plan.basePriceVnd / 30);

  const items: QuoteLineItem[] = [];
  if (months > 0) items.push(line('ROOM_CHARGE', `${months} tháng`, months, plan.basePriceVnd));
  if (partialDays > 0) items.push(line('ROOM_CHARGE', `${partialDays} ngày lẻ`, partialDays, dayRate));
  if (items.length === 0) items.push(line('ROOM_CHARGE', '1 ngày', 1, dayRate)); // tối thiểu

  return buildQuote({
    mode: 'MONTHLY',
    lineItems: items,
    depositType: plan.depositType,
    depositValue: plan.depositValue,
    holidays: [],
    notes: plan.monthlyIncludesUtilities
      ? undefined
      : 'Điện/nước tính theo chỉ số, xuất hoá đơn hằng tháng',
  });
}
