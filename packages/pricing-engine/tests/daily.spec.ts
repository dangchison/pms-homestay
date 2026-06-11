import { describe, expect, it } from 'vitest';
import { quote } from '../src/index';
import { type RatePlanConfig, type RatePlanRule } from '../src/types';

const TZ = 'Asia/Ho_Chi_Minh';
const weekendRule: RatePlanRule = {
  ruleType: 'WEEKEND',
  daysOfWeek: [0, 6],
  priceModifierType: 'PERCENT',
  priceModifierValue: 2000, // +20%
  priority: 10,
  createdAt: 0,
};

/** base 500k/đêm, nhận 14:00 / trả 12:00, phụ phí sớm 100k / trễ 150k, cọc 30%. */
const plan: RatePlanConfig = {
  mode: 'DAILY',
  timezone: TZ,
  basePriceVnd: 500_000,
  depositType: 'PERCENT',
  depositValue: 3000,
  dailyCheckinTime: '14:00',
  dailyCheckoutTime: '12:00',
  dailyEarlyCheckinFeeVnd: 100_000,
  dailyLateCheckoutFeeVnd: 150_000,
  rules: [weekendRule],
};

describe('quoteDaily (docs/07 §4, §8)', () => {
  it('1 đêm cuối tuần, rule +20% → base × 1.2 (qua roundVnd)', () => {
    // 23/5/2026 là THỨ BẢY. 14:00 VN = 07:00Z; trả 12:00 VN hôm sau
    const q = quote(
      { mode: 'DAILY', checkIn: new Date('2026-05-23T07:00:00Z'), checkOut: new Date('2026-05-24T05:00:00Z') },
      plan,
      [],
    );
    expect(q.totalVnd).toBe(600_000);
    expect(q.depositVnd).toBe(180_000); // 30% của 600k
  });

  it('★ 18:30 UTC = 01:30 VN hôm sau → đêm tính theo NGÀY VN (23/5 = T7, +20%)', () => {
    // checkIn 22/5 18:30Z → VN 23/5 01:30 (thứ Bảy). Bucket UTC sẽ là 22/5 (thứ Sáu) → SAI.
    const q = quote(
      { mode: 'DAILY', checkIn: new Date('2026-05-22T18:30:00Z'), checkOut: new Date('2026-05-24T05:00:00Z') },
      plan,
      [],
    );
    expect(q.lineItems[0]?.localDate).toBe('2026-05-23'); // đêm theo ngày VN, KHÔNG phải 22/5 (UTC)
    expect(q.lineItems[0]?.amountVnd).toBe(600_000); // weekend +20% áp đúng theo ngày VN
    // 01:30 VN < 14:00 → kèm phí nhận sớm 100k ⇒ tổng 700k (đúng hành vi)
    expect(q.totalVnd).toBe(700_000);
  });

  it('3 đêm gồm 1 đêm lễ (OVERRIDE priority cao) → base + giá lễ + base', () => {
    const holidayPlan: RatePlanConfig = {
      mode: 'DAILY',
      timezone: TZ,
      basePriceVnd: 500_000,
      rules: [
        {
          ruleType: 'HOLIDAY',
          priceModifierType: 'OVERRIDE',
          priceModifierValue: 1_200_000,
          priority: 100,
          createdAt: 0,
        },
      ],
    };
    // 01–04/7/2026, đêm 02/7 là lễ (từ input — vietnam_holidays)
    const q = quote(
      { mode: 'DAILY', checkIn: new Date('2026-07-01T07:00:00Z'), checkOut: new Date('2026-07-04T05:00:00Z') },
      holidayPlan,
      [{ date: '2026-07-02', name: 'Lễ test' }],
    );
    expect(q.lineItems).toHaveLength(3);
    expect(q.lineItems.map((l) => l.amountVnd)).toEqual([500_000, 1_200_000, 500_000]);
    expect(q.totalVnd).toBe(2_200_000);
    expect(q.holidays).toHaveLength(1);
  });

  it('đêm 30 Tết (nghỉ bù trong vietnam_holidays) → rule HOLIDAY ăn từ input', () => {
    const tetPlan: RatePlanConfig = {
      mode: 'DAILY',
      timezone: TZ,
      basePriceVnd: 500_000,
      rules: [
        { ruleType: 'HOLIDAY', priceModifierType: 'PERCENT', priceModifierValue: 5000, priority: 50, createdAt: 0 },
      ],
    };
    // Mùng 1 Tết Bính Ngọ = 17/2/2026 (seed). 1 đêm.
    const q = quote(
      { mode: 'DAILY', checkIn: new Date('2026-02-17T07:00:00Z'), checkOut: new Date('2026-02-18T05:00:00Z') },
      tetPlan,
      [{ date: '2026-02-17', name: 'Mùng 1 Tết', isLunarBased: true }],
    );
    expect(q.totalVnd).toBe(750_000); // +50%
  });

  it('check-in 11:00 (sớm hơn 14:00) → có phụ phí nhận sớm', () => {
    // 25/5/2026 (thứ Hai). 11:00 VN = 04:00Z
    const q = quote(
      { mode: 'DAILY', checkIn: new Date('2026-05-25T04:00:00Z'), checkOut: new Date('2026-05-26T05:00:00Z') },
      plan,
      [],
    );
    expect(q.lineItems.some((l) => l.description.includes('Nhận phòng sớm'))).toBe(true);
    expect(q.totalVnd).toBe(600_000); // 500k base (T2, không weekend) + 100k sớm
  });
});
