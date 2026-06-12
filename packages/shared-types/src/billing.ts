import { z } from 'zod';

/**
 * Ghi chỉ số điện/nước cho 1 booking thuê tháng theo kỳ (staff). Upsert theo
 * (booking, kỳ). Chỉ số cuối ≥ đầu (không xét rollover công-tơ ở MVP).
 */
export const RecordMeterReadingRequestSchema = z
  .object({
    booking_id: z.uuid(),
    period_year: z.number().int().min(2000).max(2100),
    period_month: z.number().int().min(1).max(12),
    electricity_kwh_start: z.number().nonnegative().optional(),
    electricity_kwh_end: z.number().nonnegative().optional(),
    water_m3_start: z.number().nonnegative().optional(),
    water_m3_end: z.number().nonnegative().optional(),
  })
  .refine(
    (d) =>
      d.electricity_kwh_end == null ||
      d.electricity_kwh_start == null ||
      d.electricity_kwh_end >= d.electricity_kwh_start,
    { message: 'Chỉ số điện cuối phải ≥ đầu', path: ['electricity_kwh_end'] },
  )
  .refine(
    (d) => d.water_m3_end == null || d.water_m3_start == null || d.water_m3_end >= d.water_m3_start,
    { message: 'Chỉ số nước cuối phải ≥ đầu', path: ['water_m3_end'] },
  );
export type RecordMeterReadingRequest = z.infer<typeof RecordMeterReadingRequestSchema>;

export const MeterReadingResponseSchema = z.object({
  id: z.uuid(),
  booking_id: z.uuid(),
  period_year: z.number().int(),
  period_month: z.number().int(),
  electricity_kwh_start: z.number().nullable(),
  electricity_kwh_end: z.number().nullable(),
  water_m3_start: z.number().nullable(),
  water_m3_end: z.number().nullable(),
  created_at: z.iso.datetime(),
});
export type MeterReadingResponse = z.infer<typeof MeterReadingResponseSchema>;

/** Kết quả 1 lần chạy billing tháng (cho night-audit + test). */
export const MonthlyBillingRunResultSchema = z.object({
  period_year: z.number().int(),
  period_month: z.number().int(),
  bookings_considered: z.number().int(),
  invoices_created: z.number().int(),
  drafts: z.number().int(), // invoice DRAFT do thiếu chỉ số điện nước
});
export type MonthlyBillingRunResult = z.infer<typeof MonthlyBillingRunResultSchema>;
