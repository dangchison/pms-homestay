import type { CalendarBlock, CalendarBooking } from '@pms/shared-types';

/**
 * Layout math thuần cho calendar timeline (task 6.2). Mọi vị trí tính theo UTC —
 * BE lưu/trả UTC ISO nên positioning nhất quán, deterministic (TZ cơ sở là tinh
 * chỉnh sau). Tách khỏi component để test/tái dùng (docs/ui/00 §4.5).
 */

export const LABEL_WIDTH = 224; // px — cột nhãn resource (frozen trái)
export const COL_WIDTH = 72; // px — bề rộng 1 ngày
export const ROW_HEIGHT = 44; // px — chiều cao 1 hàng resource
export const HEADER_HEIGHT = 52; // px — hàng ngày (frozen trên)
export const HOUR_COL_WIDTH = 56; // px — bề rộng 1 giờ (chế độ HOURLY, A3)
export const HOURS_PER_DAY = 24;

const DAY_MS = 86_400_000;
const VI_WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] as const;

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** Mốc ngày cho trục X: [from, from+days). */
export function dayColumns(from: Date, days: number): Date[] {
  const base = startOfUtcDay(from);
  return Array.from({ length: days }, (_, i) => addDays(base, i));
}

export interface DayHeader {
  date: Date;
  weekday: string; // T2..CN
  dayNum: number; // 1..31
  isToday: boolean;
  isWeekend: boolean;
}

export function dayHeaders(from: Date, days: number, now: Date): DayHeader[] {
  const today = startOfUtcDay(now).getTime();
  return dayColumns(from, days).map((date) => {
    const dow = date.getUTCDay();
    return {
      date,
      weekday: VI_WEEKDAYS[dow]!,
      dayNum: date.getUTCDate(),
      isToday: date.getTime() === today,
      isWeekend: dow === 0 || dow === 6,
    };
  });
}

/** Offset (đơn vị "ngày", phân số) của một mốc thời gian so với đầu khoảng. */
export function dayOffset(at: Date, rangeStart: Date): number {
  return (at.getTime() - startOfUtcDay(rangeStart).getTime()) / DAY_MS;
}

export interface BarRect {
  left: number;
  width: number;
}

/** Vị trí bar (px) trong track, kẹp vào [0, days] để không tràn mép. */
export function barRect(startISO: string, endISO: string, rangeStart: Date, days: number): BarRect {
  const rawStart = dayOffset(new Date(startISO), rangeStart);
  const rawEnd = dayOffset(new Date(endISO), rangeStart);
  const start = Math.max(0, Math.min(days, rawStart));
  const end = Math.max(0, Math.min(days, rawEnd));
  return { left: start * COL_WIDTH, width: Math.max(COL_WIDTH * 0.25, (end - start) * COL_WIDTH) };
}

/** Booking có giao với khoảng đang xem? (đã lọc ở BE, nhưng phòng FE filter). */
export function bookingInRange(b: CalendarBooking, rangeStart: Date, days: number): boolean {
  const end = dayOffset(new Date(b.occupancy_end), rangeStart);
  const start = dayOffset(new Date(b.occupancy_start), rangeStart);
  return end > 0 && start < days;
}

export function blockInRange(b: CalendarBlock, rangeStart: Date, days: number): boolean {
  const end = dayOffset(new Date(b.end_at), rangeStart);
  const start = dayOffset(new Date(b.start_at), rangeStart);
  return end > 0 && start < days;
}

/** Nhãn khoảng cho toolbar: "10–23/06" hoặc "10/06–02/07". */
export function rangeLabel(from: Date, days: number): string {
  const start = startOfUtcDay(from);
  const end = addDays(start, days - 1);
  const dd = (d: Date) => String(d.getUTCDate()).padStart(2, '0');
  const mm = (d: Date) => String(d.getUTCMonth() + 1).padStart(2, '0');
  if (mm(start) === mm(end)) return `${dd(start)}–${dd(end)}/${mm(end)}`;
  return `${dd(start)}/${mm(start)}–${dd(end)}/${mm(end)}`;
}

/** YYYY-MM-DD (UTC) cho query param / so sánh. */
export function ymdUtc(d: Date): string {
  return startOfUtcDay(d).toISOString().slice(0, 10);
}

// ── Chế độ giờ (HOURLY view, A3) ─────────────────────────────────────────────
// Định vị theo UTC nhất quán với lưới ngày (TZ cơ sở tinh chỉnh sau — như comment đầu file).
const HOUR_MS = 3_600_000;

/** Offset (đơn vị "giờ", phân số) của mốc thời gian so với đầu NGÀY (UTC). */
export function hourOffset(at: Date, day: Date): number {
  return (at.getTime() - startOfUtcDay(day).getTime()) / HOUR_MS;
}

export interface HourHeader {
  hour: number; // 0..23
  label: string; // "07:00"
  isNow: boolean;
}

/** 24 cột giờ cho 1 ngày; isNow = giờ hiện tại nếu `now` rơi vào ngày này (UTC). */
export function hourHeaders(day: Date, now: Date): HourHeader[] {
  const sameDay = startOfUtcDay(day).getTime() === startOfUtcDay(now).getTime();
  const nowHour = now.getUTCHours();
  return Array.from({ length: HOURS_PER_DAY }, (_, h) => ({
    hour: h,
    label: `${String(h).padStart(2, '0')}:00`,
    isNow: sameDay && h === nowHour,
  }));
}

/** Bar rect (px) trong track giờ, kẹp [0, 24] (booking qua đêm bị cắt ở mép ngày). */
export function hourBarRect(startISO: string, endISO: string, day: Date): BarRect {
  const rawStart = hourOffset(new Date(startISO), day);
  const rawEnd = hourOffset(new Date(endISO), day);
  const start = Math.max(0, Math.min(HOURS_PER_DAY, rawStart));
  const end = Math.max(0, Math.min(HOURS_PER_DAY, rawEnd));
  return {
    left: start * HOUR_COL_WIDTH,
    width: Math.max(HOUR_COL_WIDTH * 0.4, (end - start) * HOUR_COL_WIDTH),
  };
}

/** Giờ:phút (UTC) — nhãn thời gian trên bar giờ. */
export function hhmmUtc(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Nhãn 1 ngày cho toolbar chế độ giờ: "T4 10/06". */
export function dayLabel(d: Date): string {
  const day = startOfUtcDay(d);
  const dd = String(day.getUTCDate()).padStart(2, '0');
  const mm = String(day.getUTCMonth() + 1).padStart(2, '0');
  return `${VI_WEEKDAYS[day.getUTCDay()]} ${dd}/${mm}`;
}
