import { z } from 'zod';

/**
 * Báo cáo lưu trú công an (Thông tư 56) — task 7.2, docs/12 §2. Query theo property
 * + khoảng ngày check-in [from, to] (inclusive). Trả file Excel (binary, không JSON).
 */
export const PoliceReportQuerySchema = z
  .object({
    property_id: z.uuid(),
    from: z.iso.date(), // YYYY-MM-DD (theo ngày check-in)
    to: z.iso.date(),
  })
  .refine((q) => q.from <= q.to, { message: 'from phải ≤ to' });
export type PoliceReportQuery = z.infer<typeof PoliceReportQuerySchema>;
