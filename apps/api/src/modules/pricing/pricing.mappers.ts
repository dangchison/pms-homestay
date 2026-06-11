import { type QuoteLineItem } from '@pms/shared-types';
import {
  type DepositType,
  type PriceModifierType,
  type PricingMode,
  type QuoteLineItem as EngineLineItem,
  type RatePlanConfig,
  type RatePlanRule,
  type RatePlanRuleType,
  type VietnamHoliday,
} from '@pms/pricing-engine';
import { type rate_plan_rules, type rate_plans, type vietnam_holidays } from '@prisma/client';

const numOrU = (v: bigint | null): number | undefined => (v == null ? undefined : Number(v));
/** Cột TIME (Prisma DateTime, UTC time-of-day) → 'HH:mm'. */
const timeStr = (d: Date | null): string | undefined => (d ? d.toISOString().slice(11, 16) : undefined);
/** Cột DATE → 'YYYY-MM-DD'. */
const dateStr = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

export function toEngineRule(r: rate_plan_rules): RatePlanRule {
  return {
    ruleType: r.rule_type as RatePlanRuleType,
    startDate: dateStr(r.start_date),
    endDate: dateStr(r.end_date),
    daysOfWeek: r.days_of_week,
    priceModifierType: r.price_modifier_type as PriceModifierType,
    priceModifierValue: Number(r.price_modifier_value),
    priority: r.priority,
    createdAt: r.created_at,
  };
}

/** Rate plan DB → cấu hình engine (pure input). */
export function toRatePlanConfig(
  p: rate_plans,
  rules: rate_plan_rules[],
  timezone: string,
): RatePlanConfig {
  return {
    mode: p.mode as PricingMode,
    timezone,
    basePriceVnd: Number(p.base_price_vnd),
    depositType: p.deposit_type as DepositType,
    depositValue: Number(p.deposit_value),
    hourlyBaseHours: p.hourly_base_hours ?? undefined,
    hourlyExtraBlockMinutes: p.hourly_extra_block_minutes ?? undefined,
    hourlyExtraBlockPriceVnd: numOrU(p.hourly_extra_block_price_vnd),
    hourlyOvernightSurchargeVnd: numOrU(p.hourly_overnight_surcharge_vnd),
    hourlyOvernightStart: timeStr(p.hourly_overnight_start),
    hourlyOvernightEnd: timeStr(p.hourly_overnight_end),
    dailyCheckinTime: timeStr(p.daily_checkin_time),
    dailyCheckoutTime: timeStr(p.daily_checkout_time),
    dailyEarlyCheckinFeeVnd: numOrU(p.daily_early_checkin_fee_vnd),
    dailyLateCheckoutFeeVnd: numOrU(p.daily_late_checkout_fee_vnd),
    monthlyIncludesUtilities: p.monthly_includes_utilities ?? undefined,
    rules: rules.map(toEngineRule),
  };
}

export function holidayRowToEngine(h: vietnam_holidays): VietnamHoliday {
  return { date: h.holiday_date.toISOString().slice(0, 10), name: h.name };
}

/** Line item engine (camelCase) → API/DB (snake_case, khớp invoice_items). */
export function toApiLineItem(li: EngineLineItem): QuoteLineItem {
  return {
    type: li.type,
    description: li.description,
    quantity: li.quantity,
    unit_price_vnd: li.unitPriceVnd,
    amount_vnd: li.amountVnd,
    ...(li.localDate ? { local_date: li.localDate } : {}),
  };
}
