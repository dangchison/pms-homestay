import { describe, expect, it } from 'vitest';
import {
  foreignResidenceStatusLabel,
  foreignResidenceStatusVariant,
  visaMask,
  visaTypeLabel,
} from './foreign-residence-format';

/**
 * Task 2.8 (docs/19 §3 Đợt 2) — PII mask là điểm ĐÚNG-SAI cốt lõi: số thị thực/hộ chiếu
 * CHỈ được lộ tối đa 4 số cuối. Neo bằng seed: Michael Anderson visa last4 '0421'.
 */
describe('visaMask — PII (chỉ ≤4 số cuối)', () => {
  it("'0421' → '••••0421' (chỉ lộ đúng 4 số cuối, neo seed Anderson)", () => {
    expect(visaMask('0421')).toBe('••••0421');
  });

  it('null → "—" (không lộ gì)', () => {
    expect(visaMask(null)).toBe('—');
  });

  it('undefined → "—"', () => {
    expect(visaMask(undefined)).toBe('—');
  });

  it('chuỗi rỗng → "—"', () => {
    expect(visaMask('')).toBe('—');
  });

  it('LƯỚI PHÒNG THỦ: nhận cả số đầy đủ → CHỈ lộ 4 số cuối, KHÔNG lộ số đầy đủ', () => {
    const full = '1234567890';
    const out = visaMask(full);
    expect(out).toBe('••••7890');
    expect(out).not.toContain(full); // số đầy đủ KHÔNG BAO GIỜ xuất hiện
    expect(out).not.toContain('123'); // các số đầu bị che
  });

  it('KHÔNG nhánh nào phát ra >4 chữ số (bất biến an toàn PII)', () => {
    const inputs: (string | null | undefined)[] = [
      null,
      undefined,
      '',
      '1',
      '04',
      '0421',
      'B1234567',
      '999999999999',
      'AB12',
      'passport-XY9876543',
    ];
    for (const inp of inputs) {
      const digits = (visaMask(inp).match(/\d/g) ?? []).length;
      expect(digits).toBeLessThanOrEqual(4);
    }
  });
});

describe('foreignResidenceStatusLabel / Variant', () => {
  it('nhãn theo trạng thái', () => {
    expect(foreignResidenceStatusLabel('DRAFT')).toBe('Nháp');
    expect(foreignResidenceStatusLabel('SUBMITTED')).toBe('Đã gửi');
    expect(foreignResidenceStatusLabel('FAILED')).toBe('Gửi lỗi');
  });

  it('biến thể Badge theo trạng thái', () => {
    expect(foreignResidenceStatusVariant('DRAFT')).toBe('outline');
    expect(foreignResidenceStatusVariant('SUBMITTED')).toBe('secondary');
    expect(foreignResidenceStatusVariant('FAILED')).toBe('destructive');
  });
});

describe('visaTypeLabel', () => {
  it("'EXEMPT' → 'Miễn thị thực' (neo seed Kim Ji-woo)", () => {
    expect(visaTypeLabel('EXEMPT')).toBe('Miễn thị thực');
  });

  it('null → "—"', () => {
    expect(visaTypeLabel(null)).toBe('—');
  });

  it("mã khác giữ nguyên (vd 'DL')", () => {
    expect(visaTypeLabel('DL')).toBe('DL');
  });
});
