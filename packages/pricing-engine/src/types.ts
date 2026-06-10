import { type VietnamHoliday } from './holiday.types';

/**
 * Khung kiểu I/O của engine — chữ ký chốt theo docs/13 §6:
 *   quote(input, plan, holidays): Quote
 * Chi tiết field hoàn thiện ở task 2.3 (docs/07) — TODO(task 2.3).
 */

export type PricingMode = 'HOURLY' | 'DAILY' | 'MONTHLY';

export interface PricingInput {
  mode: PricingMode;
  /** UTC instants — engine tự quy đổi theo plan.timezone (docs/07 §4) */
  checkIn: Date;
  checkOut: Date;
  /** số khách, phụ thu người thêm tính ở rules */
  guests?: number;
}

/** Cấu hình rate plan + rules đã load từ DB, truyền thuần vào engine. */
export interface RatePlanConfig {
  mode: PricingMode;
  /** IANA timezone của property, vd 'Asia/Ho_Chi_Minh' */
  timezone: string;
  /** Giá cơ sở theo mode (đồng/giờ, đồng/đêm, đồng/tháng) */
  basePriceVnd: number;
  // TODO(task 2.3): deposit_type/value, hourly tiers, weekend/holiday rules,
  // điện nước cho monthly... theo docs/07 + docs/03 (rate_plans, rate_plan_rules)
  rules?: RatePlanRule[];
}

export interface RatePlanRule {
  /** priority cao thắng; tie-break theo created_at (docs/13 §6) */
  priority: number;
  createdAt: Date;
  // TODO(task 2.3): điều kiện (weekend/holiday/season/date-range) + modifier
}

export interface QuoteLine {
  /** YYYY-MM-DD theo timezone property (đêm/ngày tính tiền) */
  localDate: string;
  description: string;
  amountVnd: number;
}

export interface Quote {
  mode: PricingMode;
  lines: QuoteLine[];
  totalVnd: number;
  depositVnd: number;
  holidays: VietnamHoliday[];
}
