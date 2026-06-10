import { describe, expect, it } from 'vitest';
import { roundVnd } from '../src/round';

describe('roundVnd — hàm làm tròn duy nhất toàn hệ thống', () => {
  it('giữ nguyên số nguyên', () => {
    expect(roundVnd(0)).toBe(0);
    expect(roundVnd(150_000)).toBe(150_000);
    expect(roundVnd(-200_000)).toBe(-200_000);
  });

  it('làm tròn half-up với số dương', () => {
    expect(roundVnd(1.4)).toBe(1);
    expect(roundVnd(1.5)).toBe(2);
    expect(roundVnd(0.5)).toBe(1);
    expect(roundVnd(99_999.5)).toBe(100_000);
  });

  it('làm tròn half-away-from-zero với số âm (refund/điều chỉnh)', () => {
    expect(roundVnd(-1.4)).toBe(-1);
    expect(roundVnd(-1.5)).toBe(-2);
    expect(roundVnd(-0.5)).toBe(-1);
  });

  it('chuẩn hoá -0 về 0', () => {
    expect(Object.is(roundVnd(-0.4), 0)).toBe(true);
    expect(Object.is(roundVnd(-0), 0)).toBe(true);
  });

  it('xử lý số tiền lớn (nghìn tỷ VND vẫn chính xác trong float64)', () => {
    expect(roundVnd(999_999_999_999.4)).toBe(999_999_999_999);
    expect(roundVnd(999_999_999_999.5)).toBe(1_000_000_000_000);
  });

  it('ném TypeError với input không hữu hạn', () => {
    expect(() => roundVnd(NaN)).toThrow(TypeError);
    expect(() => roundVnd(Infinity)).toThrow(TypeError);
    expect(() => roundVnd(-Infinity)).toThrow(TypeError);
  });
});
