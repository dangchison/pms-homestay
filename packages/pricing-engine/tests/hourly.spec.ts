import { describe, expect, it } from 'vitest';
import { quote } from '../src/index';
import { type RatePlanConfig } from '../src/types';

/** Plan HOURLY mẫu (docs/07 §3 ví dụ): base 150k/2h, block 30' = 25k, đêm 200k (22:00–06:00). */
const plan: RatePlanConfig = {
  mode: 'HOURLY',
  timezone: 'Asia/Ho_Chi_Minh',
  basePriceVnd: 150_000,
  hourlyBaseHours: 2,
  hourlyExtraBlockMinutes: 30,
  hourlyExtraBlockPriceVnd: 25_000,
  hourlyOvernightSurchargeVnd: 200_000,
  hourlyOvernightStart: '22:00',
  hourlyOvernightEnd: '06:00',
};

const find = (q: ReturnType<typeof quote>, desc: string) =>
  q.lineItems.find((l) => l.description.includes(desc));

describe('quoteHourly (docs/07 §3, §8)', () => {
  it('1h < gói base 2h → tính đủ giá base', () => {
    // 13:00–14:30 VN = 06:00–07:30 UTC
    const q = quote(
      { mode: 'HOURLY', checkIn: new Date('2026-05-04T06:00:00Z'), checkOut: new Date('2026-05-04T07:30:00Z') },
      plan,
      [],
    );
    expect(q.totalVnd).toBe(150_000);
    expect(q.lineItems).toHaveLength(1);
  });

  it('4h, base 2h, block 30′, extra 25k → base + 4 block × 25k', () => {
    // 13:00–17:00 VN = 06:00–10:00 UTC (240′ → 120′ extra → ceil(120/30)=4 block)
    const q = quote(
      { mode: 'HOURLY', checkIn: new Date('2026-05-04T06:00:00Z'), checkOut: new Date('2026-05-04T10:00:00Z') },
      plan,
      [],
    );
    expect(find(q, 'block')?.quantity).toBe(4);
    expect(q.totalVnd).toBe(150_000 + 4 * 25_000);
  });

  it('21:00 → 02:00 hôm sau → 1 lần phụ thu đêm', () => {
    // 21:00 VN 04/5 = 14:00Z; 02:00 VN 05/5 = 19:00Z 04/5
    const q = quote(
      { mode: 'HOURLY', checkIn: new Date('2026-05-04T14:00:00Z'), checkOut: new Date('2026-05-04T19:00:00Z') },
      plan,
      [],
    );
    const overnight = find(q, 'Phụ thu đêm');
    expect(overnight?.quantity).toBe(1);
    // 5h: base + 6 block × 25k + 1 đêm × 200k
    expect(q.totalVnd).toBe(150_000 + 6 * 25_000 + 200_000);
  });

  it('checkout <= checkin → ném CHECKOUT_BEFORE_CHECKIN', () => {
    expect(() =>
      quote(
        { mode: 'HOURLY', checkIn: new Date('2026-05-04T10:00:00Z'), checkOut: new Date('2026-05-04T10:00:00Z') },
        plan,
        [],
      ),
    ).toThrowError(/CHECKOUT_BEFORE_CHECKIN/);
  });
});
