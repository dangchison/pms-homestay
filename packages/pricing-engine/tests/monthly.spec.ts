import { describe, expect, it } from 'vitest';
import { quote } from '../src/index';
import { type RatePlanConfig } from '../src/types';

const TZ = 'Asia/Ho_Chi_Minh';
const plan: RatePlanConfig = {
  mode: 'MONTHLY',
  timezone: TZ,
  basePriceVnd: 9_000_000,
  monthlyIncludesUtilities: false,
};

describe('quoteMonthly (docs/07 §5, §8)', () => {
  it('1.5 tháng → 1 tháng + 15 ngày × (base/30)', () => {
    // 01/5 → 16/6 VN (00:00 VN = 17:00Z hôm trước)
    const q = quote(
      { mode: 'MONTHLY', checkIn: new Date('2026-04-30T17:00:00Z'), checkOut: new Date('2026-06-15T17:00:00Z') },
      plan,
      [],
    );
    expect(q.lineItems[0]).toMatchObject({ quantity: 1, amountVnd: 9_000_000 });
    expect(q.lineItems[1]).toMatchObject({ quantity: 15, amountVnd: 15 * 300_000 }); // base/30 = 300k
    expect(q.totalVnd).toBe(9_000_000 + 4_500_000);
    expect(q.notes).toContain('Điện/nước'); // không gồm tiện ích
  });

  it('đúng 3 tháng → 3 × base, không ngày lẻ', () => {
    const q = quote(
      { mode: 'MONTHLY', checkIn: new Date('2026-04-30T17:00:00Z'), checkOut: new Date('2026-07-31T17:00:00Z') },
      plan,
      [],
    );
    expect(q.lineItems).toHaveLength(1);
    expect(q.lineItems[0]).toMatchObject({ quantity: 3, unitPriceVnd: 9_000_000, amountVnd: 27_000_000 });
    expect(q.totalVnd).toBe(27_000_000);
  });

  it('gồm tiện ích → không có ghi chú điện nước', () => {
    const q = quote(
      { mode: 'MONTHLY', checkIn: new Date('2026-04-30T17:00:00Z'), checkOut: new Date('2026-05-31T17:00:00Z') },
      { ...plan, monthlyIncludesUtilities: true },
      [],
    );
    expect(q.notes).toBeUndefined();
  });
});
