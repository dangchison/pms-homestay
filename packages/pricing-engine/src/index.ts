/**
 * @pms/pricing-engine — PURE FUNCTIONS (docs/13 §6).
 * Không import NestJS, không chạm DB, không Date.now() ngầm: mọi dữ liệu
 * (rate plan, ngày lễ, thời điểm) truyền qua input. BE và FE dùng chung.
 */
import { type VietnamHoliday } from './holiday.types';
import { quoteDaily } from './daily';
import { quoteHourly } from './hourly';
import { quoteMonthly } from './monthly';
import { type PricingInput, type Quote, type RatePlanConfig } from './types';

export * from './types';
export * from './holiday.types';
export * from './round';
export * from './timezone';
export * from './dateutil';
export { quoteHourly } from './hourly';
export { quoteDaily } from './daily';
export { quoteMonthly } from './monthly';
export { applyRatePlanRules, matchesDate, computeDatePrice } from './rules';
export { line, buildQuote, computeDeposit } from './builder';

/** Entry point hợp nhất theo docs/13 §6: quote(input, plan, holidays): Quote */
export function quote(
  input: PricingInput,
  plan: RatePlanConfig,
  holidays: VietnamHoliday[],
): Quote {
  switch (input.mode) {
    case 'HOURLY':
      return quoteHourly(input, plan, holidays);
    case 'DAILY':
      return quoteDaily(input, plan, holidays);
    case 'MONTHLY':
      return quoteMonthly(input, plan, holidays);
  }
}
