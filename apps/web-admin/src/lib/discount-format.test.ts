import { describe, expect, it } from 'vitest';
import {
  bpToPct,
  discountReasonMessage,
  formatDiscountValue,
  pctToBp,
} from './discount-format';
import { vnd } from './format';

/**
 * Task 2.2 (docs/19 §3 Đợt 2) — đơn vị mã giảm giá là điểm ĐÚNG-SAI cốt lõi:
 * discount_value của PERCENT là basis-point (1000 = 10%, PERCENT_BP_DIVISOR=10000 ở
 * discounts.service). Hiển thị = value/100 + '%'; tạo/sửa = Math.round(pct*100). Neo
 * bằng seed SUMMER10=1000bp → '10%', HETHAN=2000bp → '20%'.
 */
describe('formatDiscountValue', () => {
  it('PERCENT: 1000 bp → "10%" (neo seed SUMMER10)', () => {
    expect(formatDiscountValue('PERCENT', 1000)).toBe('10%');
  });

  it('PERCENT: 2000 bp → "20%" (neo seed HETHAN)', () => {
    expect(formatDiscountValue('PERCENT', 2000)).toBe('20%');
  });

  it('PERCENT: 10000 bp → "100%" (mẫu số basis-point)', () => {
    expect(formatDiscountValue('PERCENT', 10_000)).toBe('100%');
  });

  it('FIXED: 50000 → tiền VND qua vnd() (neo seed GIAM50K)', () => {
    expect(formatDiscountValue('FIXED', 50_000)).toBe(vnd(50_000));
    expect(formatDiscountValue('FIXED', 50_000)).toContain('50.000');
  });
});

describe('bpToPct / pctToBp round-trip', () => {
  it('bpToPct: 1000 → 10, 2000 → 20', () => {
    expect(bpToPct(1000)).toBe(10);
    expect(bpToPct(2000)).toBe(20);
  });

  it('pctToBp: 10 → 1000 (Math.round), 20 → 2000', () => {
    expect(pctToBp(10)).toBe(1000);
    expect(pctToBp(20)).toBe(2000);
  });

  it('round-trip bp → pct → bp giữ nguyên giá trị', () => {
    for (const bp of [0, 1000, 2000, 500, 10_000]) {
      expect(pctToBp(bpToPct(bp))).toBe(bp);
    }
  });

  it('pctToBp làm tròn phần thập phân (7.5% → 750 bp)', () => {
    expect(pctToBp(7.5)).toBe(750);
  });
});

describe('discountReasonMessage', () => {
  it('EXPIRED → thông điệp "hết hạn"', () => {
    expect(discountReasonMessage('EXPIRED')).toContain('hết hạn');
  });

  it('USAGE_LIMIT_REACHED → thông điệp "lượt"', () => {
    expect(discountReasonMessage('USAGE_LIMIT_REACHED')).toContain('lượt');
  });

  it('PROPERTY_NOT_ELIGIBLE → thông điệp "cơ sở"', () => {
    expect(discountReasonMessage('PROPERTY_NOT_ELIGIBLE')).toContain('cơ sở');
  });

  it('BELOW_MIN_ORDER → thông điệp "tối thiểu"', () => {
    expect(discountReasonMessage('BELOW_MIN_ORDER')).toContain('tối thiểu');
  });

  it('reason không xác định → fallback (không rỗng, không crash)', () => {
    expect(discountReasonMessage('SOMETHING_UNKNOWN')).toBe('Mã giảm giá không áp dụng được.');
  });

  it('undefined → fallback', () => {
    expect(discountReasonMessage(undefined)).toBe('Mã giảm giá không áp dụng được.');
  });
});
