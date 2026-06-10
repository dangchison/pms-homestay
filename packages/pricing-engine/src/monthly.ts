import { type PricingInput, type Quote, type RatePlanConfig } from './types';
import { type VietnamHoliday } from './holiday.types';

/** Tính giá thuê theo tháng (kèm chu kỳ điện nước) — TODO(task 2.3, docs/07 §2 + docs/09 §4.5). */
export function quoteMonthly(
  _input: PricingInput,
  _plan: RatePlanConfig,
  _holidays: VietnamHoliday[],
): Quote {
  throw new Error('TODO(task 2.3): quoteMonthly chưa implement — xem docs/07-pricing-engine.md §2');
}
