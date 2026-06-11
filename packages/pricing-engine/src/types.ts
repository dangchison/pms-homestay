import { type VietnamHoliday } from './holiday.types';

/**
 * Khung kiểu I/O của engine (docs/07, chữ ký docs/13 §6): quote(input, plan, holidays).
 * PURE — mọi dữ liệu (plan, rules, holidays, timezone) đi vào qua input.
 */

export type PricingMode = 'HOURLY' | 'DAILY' | 'MONTHLY';
export type DepositType = 'NONE' | 'FIXED' | 'PERCENT';
export type PriceModifierType = 'FIXED' | 'PERCENT' | 'OVERRIDE';
export type RatePlanRuleType = 'WEEKDAY' | 'WEEKEND' | 'HOLIDAY' | 'SEASON' | 'DATE_RANGE';

/** Loại dòng giá — khớp invoice_items.item_type (docs/03 §4.6). */
export type LineItemType = 'ROOM_CHARGE' | 'SURCHARGE' | 'DISCOUNT' | 'TAX' | 'UTILITY' | 'AMENITY';

export interface PricingInput {
  mode: PricingMode;
  /** UTC instants — engine quy đổi theo plan.timezone (docs/07 §4) */
  checkIn: Date;
  checkOut: Date;
  adults?: number;
  children?: number;
}

export interface RatePlanRule {
  ruleType: RatePlanRuleType;
  /** YYYY-MM-DD (theo local property); null/bỏ trống = mở một phía */
  startDate?: string | null;
  endDate?: string | null;
  /** [0..6], 0=CN; rỗng/không set = mọi ngày (WEEKDAY/WEEKEND suy ra mặc định) */
  daysOfWeek?: number[];
  priceModifierType: PriceModifierType;
  /** PERCENT theo basis point (1500 = +15%); FIXED/PERCENT có thể âm; OVERRIDE = giá tuyệt đối */
  priceModifierValue: number;
  /** cao hơn thắng */
  priority: number;
  /** tie-break khi cùng priority (xác định, KHÔNG theo id) */
  createdAt: Date | number;
}

/** Cấu hình rate plan đã load từ DB, truyền thuần vào engine (docs/03 §4.4). */
export interface RatePlanConfig {
  mode: PricingMode;
  /** IANA timezone của property, vd 'Asia/Ho_Chi_Minh' */
  timezone: string;
  basePriceVnd: number;

  depositType?: DepositType;
  depositValue?: number; // VND nếu FIXED; basis point nếu PERCENT (3000 = 30%)

  // HOURLY
  hourlyBaseHours?: number;
  hourlyExtraBlockMinutes?: number;
  hourlyExtraBlockPriceVnd?: number;
  hourlyOvernightSurchargeVnd?: number;
  hourlyOvernightStart?: string; // 'HH:mm'
  hourlyOvernightEnd?: string; // 'HH:mm'

  // DAILY
  dailyCheckinTime?: string; // 'HH:mm'
  dailyCheckoutTime?: string; // 'HH:mm'
  dailyEarlyCheckinFeeVnd?: number;
  dailyLateCheckoutFeeVnd?: number;

  // MONTHLY
  monthlyIncludesUtilities?: boolean;

  rules?: RatePlanRule[];
}

export interface QuoteLineItem {
  type: LineItemType;
  description: string;
  quantity: number;
  unitPriceVnd: number;
  amountVnd: number;
  /** YYYY-MM-DD (local) cho dòng theo đêm — phục vụ breakdown/hiển thị */
  localDate?: string;
}

export interface Quote {
  mode: PricingMode;
  lineItems: QuoteLineItem[];
  subtotalVnd: number;
  discountVnd: number;
  taxVnd: number;
  totalVnd: number;
  depositVnd: number;
  /** ngày lễ đã áp dụng khi tính (FE hiển thị "có giá lễ") */
  holidays: VietnamHoliday[];
  notes?: string;
}

/** Lỗi nghiệp vụ pricing — service map sang RFC 7807 (PRICING_*). */
export class PricingError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ? `${code}: ${message}` : code);
    this.name = 'PricingError';
  }
}
