import { describe, expect, it } from 'vitest';
import { maskEmail, maskPhone } from './format';

/**
 * Task 1.2 — PII mask client-side cho card khách (docs/19 §2 Đợt 1). SĐT/email KHÔNG
 * bao giờ render đầy đủ; chỉ đủ để nhân viên đối chiếu. `null` → '—'.
 */
describe('maskPhone', () => {
  it('giữ 3 số cuối, che phần đầu bằng bullet', () => {
    expect(maskPhone('0912345678')).toBe('•••••••678');
  });

  it('null → dash', () => {
    expect(maskPhone(null)).toBe('—');
  });

  it('số ngắn (≤3) không lộ toàn bộ', () => {
    // '12' chỉ 2 ký tự — không có gì để "giữ 3 cuối" mà lộ hết → che sạch.
    expect(maskPhone('12')).toBe('••');
  });
});

describe('maskEmail', () => {
  it('giữ ký tự đầu local-part + domain', () => {
    expect(maskEmail('nguyen@gmail.com')).toBe('n•••@gmail.com');
  });

  it('null → dash', () => {
    expect(maskEmail(null)).toBe('—');
  });
});
