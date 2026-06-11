/**
 * Phép "rơi vào ngày nào / giờ nào" BẮT BUỘC tính theo timezone của property
 * (docs/07 §4). Server luôn UTC — không bao giờ dùng getDate()/getHours() trần.
 */

/** YYYY-MM-DD của một thời điểm theo timezone property (vd 'Asia/Ho_Chi_Minh'). */
export function localDate(instant: Date, timeZone: string): string {
  // en-CA cho định dạng YYYY-MM-DD ổn định
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** HH:mm (24h) của một thời điểm theo timezone property. */
export function localTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}

/**
 * Thời điểm "giả UTC" mang đúng giờ tường minh ĐỊA PHƯƠNG — CHỈ dùng để so sánh
 * trong cùng một khung local (vd đếm cửa sổ đêm hourly). KHÔNG phải instant thật.
 * (VN không có DST nên trùng khít; nơi có DST có thể lệch 1h ở ranh giới chuyển.)
 */
export function localWallClock(instant: Date, timeZone: string): Date {
  return new Date(`${localDate(instant, timeZone)}T${localTime(instant, timeZone)}:00Z`);
}

/** Thứ trong tuần (0 = CN … 6 = T7) theo timezone property. */
export function localDayOfWeek(instant: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(instant);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = map[name];
  if (dow === undefined) throw new Error(`localDayOfWeek: weekday không nhận diện được: ${name}`);
  return dow;
}
