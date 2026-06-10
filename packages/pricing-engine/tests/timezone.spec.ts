import { describe, expect, it } from 'vitest';
import { localDate, localDayOfWeek, localTime } from '../src/timezone';

const VN = 'Asia/Ho_Chi_Minh';

describe('timezone helpers — phép "rơi vào ngày nào" theo TZ property (docs/07 §4)', () => {
  it('18:00 UTC = 01:00 hôm sau giờ VN → localDate phải là hôm sau', () => {
    const instant = new Date('2026-06-10T18:00:00.000Z');
    expect(localDate(instant, VN)).toBe('2026-06-11');
    expect(localDate(instant, 'UTC')).toBe('2026-06-10');
  });

  it('localTime trả HH:mm 24h theo TZ', () => {
    const instant = new Date('2026-06-10T18:30:00.000Z');
    expect(localTime(instant, VN)).toBe('01:30');
  });

  it('localDayOfWeek tính đúng khi qua ngày theo TZ', () => {
    // 2026-06-13 là thứ Bảy; 17:30 UTC thứ Bảy = 00:30 Chủ nhật giờ VN
    const instant = new Date('2026-06-13T17:30:00.000Z');
    expect(localDayOfWeek(instant, 'UTC')).toBe(6);
    expect(localDayOfWeek(instant, VN)).toBe(0);
  });
});
