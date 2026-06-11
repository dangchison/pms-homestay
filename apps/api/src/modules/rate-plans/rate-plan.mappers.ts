import {
  type DepositType,
  type PriceModifierType,
  type RatePlanResponse,
  type RatePlanRuleResponse,
  type RatePlanRuleType,
} from '@pms/shared-types';
import { type rate_plan_rules, type rate_plans } from '@prisma/client';

// ── Chuyển đổi kiểu DB ↔ API ─────────────────────────────────────────────────

const num = (v: bigint | null): number | null => (v == null ? null : Number(v));

/** 'HH:mm' → Date cột TIME (epoch 1970-01-01, UTC time-of-day). */
export function timeToDate(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

/** Date cột TIME → 'HH:mm'. */
function dateToTime(d: Date | null): string | null {
  return d ? d.toISOString().slice(11, 16) : null;
}

/** 'YYYY-MM-DD' → Date cột DATE (UTC midnight). */
export function ymdToDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** Date cột DATE → 'YYYY-MM-DD'. */
function dateToYmd(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function toRuleResponse(r: rate_plan_rules): RatePlanRuleResponse {
  return {
    id: r.id,
    rate_plan_id: r.rate_plan_id,
    rule_type: r.rule_type as RatePlanRuleType,
    start_date: dateToYmd(r.start_date),
    end_date: dateToYmd(r.end_date),
    days_of_week: r.days_of_week.length ? r.days_of_week : null,
    price_modifier_type: r.price_modifier_type as PriceModifierType,
    price_modifier_value: Number(r.price_modifier_value),
    priority: r.priority,
    notes: r.notes,
    created_at: r.created_at.toISOString(),
  };
}

export function toRatePlanResponse(
  p: rate_plans,
  resourceIds: string[],
  rules?: rate_plan_rules[],
): RatePlanResponse {
  return {
    id: p.id,
    property_id: p.property_id,
    name: p.name,
    mode: p.mode,
    is_default: p.is_default,
    is_active: p.is_active,
    version: p.version,
    base_price_vnd: Number(p.base_price_vnd),
    deposit_type: p.deposit_type as DepositType,
    deposit_value: Number(p.deposit_value),
    hourly_base_hours: p.hourly_base_hours,
    hourly_extra_block_minutes: p.hourly_extra_block_minutes,
    hourly_extra_block_price_vnd: num(p.hourly_extra_block_price_vnd),
    hourly_overnight_surcharge_vnd: num(p.hourly_overnight_surcharge_vnd),
    hourly_overnight_start: dateToTime(p.hourly_overnight_start),
    hourly_overnight_end: dateToTime(p.hourly_overnight_end),
    daily_checkin_time: dateToTime(p.daily_checkin_time),
    daily_checkout_time: dateToTime(p.daily_checkout_time),
    daily_early_checkin_fee_vnd: num(p.daily_early_checkin_fee_vnd),
    daily_late_checkout_fee_vnd: num(p.daily_late_checkout_fee_vnd),
    monthly_includes_utilities: p.monthly_includes_utilities,
    monthly_electricity_per_kwh_vnd: num(p.monthly_electricity_per_kwh_vnd),
    monthly_water_per_m3_vnd: num(p.monthly_water_per_m3_vnd),
    effective_from: dateToYmd(p.effective_from)!,
    effective_to: dateToYmd(p.effective_to),
    resource_ids: resourceIds,
    ...(rules ? { rules: rules.map(toRuleResponse) } : {}),
    created_at: p.created_at.toISOString(),
    updated_at: p.updated_at.toISOString(),
  };
}
