import { z } from 'zod';
import { MoneyVndSchema } from './common';

/** P&L theo cơ sở trong khoảng [from, to] (docs/09 §8). */
export const PnlQuerySchema = z
  .object({
    property_id: z.uuid(),
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine((d) => d.from <= d.to, { message: 'from phải ≤ to', path: ['from'] });
export type PnlQuery = z.infer<typeof PnlQuerySchema>;

export const PnlResponseSchema = z.object({
  property_id: z.uuid(),
  from: z.string(),
  to: z.string(),
  // Doanh thu (rollup quá khứ + live hôm nay)
  revenue_room_vnd: MoneyVndSchema,
  revenue_other_vnd: MoneyVndSchema,
  revenue_total_vnd: MoneyVndSchema,
  // Chi phí trực tiếp (thuê nhà, điện nước, vật tư, hoa hồng OTA)
  direct_cost_vnd: MoneyVndSchema,
  gross_profit_vnd: z.number().int(), // có thể âm
  // Chi phí vận hành (lương, marketing, bảo trì) + khấu hao
  operating_cost_vnd: MoneyVndSchema,
  depreciation_vnd: MoneyVndSchema,
  operating_profit_vnd: z.number().int(),
  // Thuế (estimate — MVP = 0) → lợi nhuận ròng
  tax_estimate_vnd: MoneyVndSchema,
  net_profit_vnd: z.number().int(),
  // Occupancy
  available_room_nights: z.number().int(),
  occupied_room_nights: z.number().int(),
  occupancy_rate_pct: z.number(),
  adr_vnd: MoneyVndSchema,
  revpar_vnd: MoneyVndSchema,
  // Chi tiết chi phí theo loại (operational_expenses + DEPRECIATION)
  expense_by_type: z.record(z.string(), z.number().int()),
});
export type PnlResponse = z.infer<typeof PnlResponseSchema>;

/** Break-even occupancy theo tháng (docs/09 §10). */
export const BreakEvenQuerySchema = z.object({
  property_id: z.uuid(),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'period dạng YYYY-MM'),
});
export type BreakEvenQuery = z.infer<typeof BreakEvenQuerySchema>;

export const BreakEvenScenarioSchema = z.object({
  adr_vnd: MoneyVndSchema,
  break_even_occupancy_pct: z.number().nullable(), // null nếu ADR ≤ V_day (không hoà vốn)
});
export type BreakEvenScenario = z.infer<typeof BreakEvenScenarioSchema>;

export const BreakEvenResponseSchema = z.object({
  property_id: z.uuid(),
  period: z.string(),
  available_room_nights: z.number().int(),
  occupied_room_nights: z.number().int(),
  current_occupancy_pct: z.number(),
  current_adr_vnd: MoneyVndSchema,
  current_revpar_vnd: MoneyVndSchema,
  fixed_cost_vnd: MoneyVndSchema,
  variable_cost_per_night_vnd: MoneyVndSchema,
  // pessimistic = ADR thấp nhất 12 tháng · realistic = TB 6 tháng · optimistic = cao nhất 12 tháng
  scenarios: z.object({
    pessimistic: BreakEvenScenarioSchema,
    realistic: BreakEvenScenarioSchema,
    optimistic: BreakEvenScenarioSchema,
  }),
});
export type BreakEvenResponse = z.infer<typeof BreakEvenResponseSchema>;

/** GET /reports/occupancy (task 6.5, R3) — đọc rollup daily_property_stats theo ngày. */
export const OccupancyReportQuerySchema = z
  .object({
    property_id: z.uuid(),
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine((d) => d.to >= d.from, { message: 'to phải ≥ from', path: ['to'] });
export type OccupancyReportQuery = z.infer<typeof OccupancyReportQuerySchema>;

export const OccupancyDaySchema = z.object({
  stat_date: z.string(), // YYYY-MM-DD
  available_room_nights: z.number().int(),
  occupied_room_nights: z.number().int(),
  occupancy_rate_pct: z.number(),
  adr_vnd: MoneyVndSchema,
  revpar_vnd: MoneyVndSchema,
  room_revenue_vnd: MoneyVndSchema,
});
export type OccupancyDay = z.infer<typeof OccupancyDaySchema>;

export const OccupancyReportResponseSchema = z.object({
  property_id: z.uuid(),
  from: z.string(),
  to: z.string(),
  days: z.array(OccupancyDaySchema),
});
export type OccupancyReportResponse = z.infer<typeof OccupancyReportResponseSchema>;

/**
 * Landlord statement (R2R) — báo cáo kỳ cho CHỦ NHÀ GỐC của cơ sở rent-to-rent
 * (docs/16 #14). Query giống P&L (cơ sở + khoảng ngày); chỉ cơ sở `is_rent_to_rent`.
 */
export const LandlordStatementQuerySchema = z
  .object({
    property_id: z.uuid(),
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine((d) => d.from <= d.to, { message: 'from phải ≤ to', path: ['from'] });
export type LandlordStatementQuery = z.infer<typeof LandlordStatementQuerySchema>;

/** Mô hình thanh toán cho chủ nhà gốc: chia % doanh thu · thuê cố định · chưa cấu hình. */
export const LandlordSettlementModelSchema = z.enum(['REVENUE_SHARE', 'FIXED_RENT', 'NONE']);
export type LandlordSettlementModel = z.infer<typeof LandlordSettlementModelSchema>;

export const LandlordStatementResponseSchema = z.object({
  property_id: z.uuid(),
  property_name: z.string(),
  from: z.string(),
  to: z.string(),
  // Chủ nhà gốc + hợp đồng (từ properties)
  landlord_name: z.string().nullable(),
  landlord_phone: z.string().nullable(),
  contract_start: z.string().nullable(),
  contract_end: z.string().nullable(),
  // Doanh thu kỳ (rollup + live hôm nay, như P&L)
  revenue_room_vnd: MoneyVndSchema,
  revenue_other_vnd: MoneyVndSchema,
  revenue_total_vnd: MoneyVndSchema,
  // Chi phí vận hành kỳ — KHÔNG gồm RENT_LANDLORD (tránh trùng tiền thuê trả chủ nhà)
  operating_cost_vnd: MoneyVndSchema,
  // Mô hình + tham số hợp đồng
  settlement_model: LandlordSettlementModelSchema,
  revenue_share_bp: z.number().int().nullable(), // set khi REVENUE_SHARE
  monthly_landlord_rent_vnd: z.number().int().nullable(), // set khi FIXED_RENT
  // Tiền chủ nhà gốc nhận trong kỳ (share % doanh thu HOẶC thuê prorate theo ngày)
  landlord_payout_vnd: MoneyVndSchema,
  // Bối cảnh occupancy
  available_room_nights: z.number().int(),
  occupied_room_nights: z.number().int(),
  occupancy_rate_pct: z.number(),
});
export type LandlordStatementResponse = z.infer<typeof LandlordStatementResponseSchema>;

/**
 * Báo cáo anti-fraud (Fraud pattern report) — docs/16 #11, Wave 1 chống thất thoát
 * tiền mặt. Chỉ đọc, property-scoped, KHÔNG lộ PII khách (chỉ booking_code + staff).
 * Query giống P&L (cơ sở + khoảng ngày).
 */
export const AntiFraudQuerySchema = z
  .object({
    property_id: z.uuid(),
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine((d) => d.from <= d.to, { message: 'from phải ≤ to', path: ['from'] });
export type AntiFraudQuery = z.infer<typeof AntiFraudQuerySchema>;

/**
 * 4 dấu hiệu gian lận tiền mặt (Wave 1):
 * - CANCEL_AFTER_CASH: hủy booking SAU khi đã thu tiền mặt.
 * - REFUND_ANOMALY_BY_STAFF: 1 nhân viên hoàn tiền bất thường (vượt ngưỡng / z-score).
 * - NO_SHOW_DEPOSIT_REMOVED: booking NO_SHOW có cọc từng thu nhưng bị rút (VOID/refund).
 * - PRICE_EDIT_AFTER_CHECKIN: sửa giá/tiền booking-invoice SAU khi khách đã check-in.
 */
export const AntiFraudFindingTypeSchema = z.enum([
  'CANCEL_AFTER_CASH',
  'REFUND_ANOMALY_BY_STAFF',
  'NO_SHOW_DEPOSIT_REMOVED',
  'PRICE_EDIT_AFTER_CHECKIN',
]);
export type AntiFraudFindingType = z.infer<typeof AntiFraudFindingTypeSchema>;

export const AntiFraudSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type AntiFraudSeverity = z.infer<typeof AntiFraudSeveritySchema>;

/** Loại thực thể gắn finding — số ít (service map plural 'bookings'/'invoices' → singular). */
export const AntiFraudEntityTypeSchema = z.enum(['booking', 'invoice', 'payment']);
export type AntiFraudEntityType = z.infer<typeof AntiFraudEntityTypeSchema>;

/**
 * Một dấu hiệu gian lận. KHÔNG chứa PII khách (chỉ booking_code + staff id/name).
 * amount_vnd = số tiền liên quan (net); occurred_at = thời điểm sự kiện đặc trưng.
 */
export const AntiFraudFindingSchema = z.object({
  type: AntiFraudFindingTypeSchema,
  severity: AntiFraudSeveritySchema,
  booking_code: z.string().nullable(),
  staff_id: z.string().nullable(),
  staff_name: z.string().nullable(),
  amount_vnd: MoneyVndSchema,
  occurred_at: z.string(), // ISO
  entity_type: AntiFraudEntityTypeSchema,
  entity_id: z.string(),
  detail: z.string(),
});
export type AntiFraudFinding = z.infer<typeof AntiFraudFindingSchema>;

export const AntiFraudSummarySchema = z.object({
  total: z.number().int(),
  by_type: z.record(z.string(), z.number().int()),
  by_severity: z.record(z.string(), z.number().int()),
});
export type AntiFraudSummary = z.infer<typeof AntiFraudSummarySchema>;

export const AntiFraudResponseSchema = z.object({
  property_id: z.uuid(),
  from: z.string(),
  to: z.string(),
  generated_at: z.string(), // ISO
  summary: AntiFraudSummarySchema,
  findings: z.array(AntiFraudFindingSchema),
});
export type AntiFraudResponse = z.infer<typeof AntiFraudResponseSchema>;
