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
