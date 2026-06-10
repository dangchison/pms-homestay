import { type PricingInput, type Quote, type RatePlanConfig } from './types';
import { type VietnamHoliday } from './holiday.types';

/** Tính giá thuê theo ngày/đêm — TODO(task 2.3, docs/07 §2). */
export function quoteDaily(
  _input: PricingInput,
  _plan: RatePlanConfig,
  _holidays: VietnamHoliday[],
): Quote {
  throw new Error('TODO(task 2.3): quoteDaily chưa implement — xem docs/07-pricing-engine.md §2');
}
