import { describe, expect, it } from 'vitest';
import { VietqrService, crc16ccitt } from '@modules/payments/vietqr.service';

/** Pure unit test (không DB) — chuỗi NAPAS 247 + CRC (docs/12 §5, task 3.3). */
describe('VietQR builder (task 3.3)', () => {
  const svc = new VietqrService();

  it('CRC16-CCITT (FALSE) khớp vector chuẩn "123456789" → 29B1', () => {
    expect(crc16ccitt('123456789')).toBe('29B1');
  });

  it('payload đúng cấu trúc EMVCo + CRC tự nhất quán', () => {
    const payload = svc.buildPayload({
      bankBin: '970422',
      accountNumber: '0123456789',
      amount: 300_000,
      addInfo: 'BK-202704-0001',
    });
    // format indicator 01 + dynamic 12 + mở tag 38 (merchant account)
    expect(payload.startsWith('00020101021238')).toBe(true);
    expect(payload).toContain('A000000727'); // GUID NAPAS
    expect(payload).toContain('970422'); // acquirer BIN
    expect(payload).toContain('0123456789'); // số tài khoản
    expect(payload).toContain('5303704'); // currency VND
    expect(payload).toContain('5406300000'); // tag54 len06 "300000"
    expect(payload).toContain('5802VN'); // country
    expect(payload).toContain('BK-202704-0001'); // addInfo
    // 4 ký tự cuối = CRC16 của toàn bộ phần trước (gồm '6304')
    const body = payload.slice(0, -4);
    expect(body.endsWith('6304')).toBe(true);
    expect(payload.slice(-4)).toBe(crc16ccitt(body));
  });
});
