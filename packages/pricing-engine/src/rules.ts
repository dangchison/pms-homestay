import { roundVnd } from './round';
import { type RatePlanRule } from './types';

function createdMs(r: RatePlanRule): number {
  return typeof r.createdAt === 'number' ? r.createdAt : r.createdAt.getTime();
}

/**
 * Rule có áp cho một ngày local không (docs/07 §4)?
 * - trong [startDate, endDate] (nếu set)
 * - đúng thứ-trong-tuần (daysOfWeek nếu set; WEEKEND/WEEKDAY suy ra mặc định)
 * - HOLIDAY: ngày phải nằm trong tập ngày lễ (từ input — vietnam_holidays)
 */
export function matchesDate(
  rule: RatePlanRule,
  localDate: string,
  dow: number,
  holidays: ReadonlySet<string>,
): boolean {
  if (rule.startDate && localDate < rule.startDate) return false;
  if (rule.endDate && localDate > rule.endDate) return false;

  const days = rule.daysOfWeek;
  if (days && days.length > 0) {
    if (!days.includes(dow)) return false;
  } else if (rule.ruleType === 'WEEKEND') {
    if (dow !== 0 && dow !== 6) return false;
  } else if (rule.ruleType === 'WEEKDAY') {
    if (dow < 1 || dow > 5) return false;
  }

  if (rule.ruleType === 'HOLIDAY' && !holidays.has(localDate)) return false;
  return true;
}

/**
 * Rules áp cho một ngày, sort priority DESC rồi createdAt ASC (tie-break xác định).
 * Đã được validate khi ghi (task 2.2): KHÔNG có 2 rule cùng priority chồng ngày.
 */
export function applyRatePlanRules(
  rules: RatePlanRule[],
  localDate: string,
  dow: number,
  holidays: ReadonlySet<string>,
): RatePlanRule[] {
  return rules
    .filter((r) => matchesDate(r, localDate, dow, holidays))
    .sort((a, b) => b.priority - a.priority || createdMs(a) - createdMs(b));
}

/**
 * Giá một ngày sau khi áp rules lên base (docs/07 §4 computeNightPrice):
 * OVERRIDE (ưu tiên cao nhất) thắng tuyệt đối; FIXED cộng; PERCENT nhân (basis point).
 */
export function computeDatePrice(
  basePriceVnd: number,
  rules: RatePlanRule[],
  localDate: string,
  dow: number,
  holidays: ReadonlySet<string>,
): number {
  const applicable = applyRatePlanRules(rules, localDate, dow, holidays);
  let price = basePriceVnd;
  for (const rule of applicable) {
    switch (rule.priceModifierType) {
      case 'OVERRIDE':
        return rule.priceModifierValue;
      case 'FIXED':
        price += rule.priceModifierValue;
        break;
      case 'PERCENT':
        price = roundVnd(price * (1 + rule.priceModifierValue / 10_000));
        break;
    }
  }
  return price;
}
