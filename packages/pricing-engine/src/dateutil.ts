/**
 * Calendar math thuần trên chuỗi YYYY-MM-DD (đã ở khung local của property).
 * Không liên quan timezone — caller phải đưa local date string (xem timezone.ts).
 */

function ymdToUtc(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function utcToYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** s + n ngày (n có thể âm) → YYYY-MM-DD. */
export function addDays(s: string, n: number): string {
  const d = ymdToUtc(s);
  d.setUTCDate(d.getUTCDate() + n);
  return utcToYmd(d);
}

/** Số ngày lịch giữa a và b (b - a); cùng ngày = 0. */
export function diffCalendarDays(a: string, b: string): number {
  return Math.round((ymdToUtc(b).getTime() - ymdToUtc(a).getTime()) / 86_400_000);
}

/** s + n tháng, kẹp về ngày cuối tháng nếu tràn (31/1 + 1 → 28/2). */
export function addMonths(s: string, n: number): string {
  const d = ymdToUtc(s);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return utcToYmd(d);
}

/** Thứ trong tuần của một ngày lịch (0=CN..6=T7) — ngày local nên không phụ thuộc tz. */
export function dayOfWeek(s: string): number {
  return ymdToUtc(s).getUTCDay();
}

/** Số tháng TRỌN VẸN từ a đến b (b >= a): n lớn nhất sao cho addMonths(a, n) <= b. */
export function fullMonthsBetween(a: string, b: string): number {
  if (b <= a) return 0;
  let n = 0;
  while (addMonths(a, n + 1) <= b) n += 1;
  return n;
}
