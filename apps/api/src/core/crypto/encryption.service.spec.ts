import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type Env } from '@core/config/env.schema';
import { EncryptionService } from './encryption.service';

function makeService(): EncryptionService {
  const env = {
    PII_ENC_KEY_CURRENT: `k1:${randomBytes(32).toString('base64')}`,
    PII_HMAC_KEY: randomBytes(32).toString('base64'),
  } as Env;
  return new EncryptionService(env);
}

describe('EncryptionService (ADR-0007)', () => {
  it('encrypt → decrypt roundtrip, payload có key_id prefix', () => {
    const svc = makeService();
    const secret = 'JBSWY3DPEHPK3PXP'; // TOTP secret mẫu
    const payload = svc.encrypt(secret);
    expect(payload.startsWith('k1:')).toBe(true);
    expect(svc.decrypt(payload)).toBe(secret);
  });

  it('mỗi lần encrypt cho ciphertext khác nhau (IV ngẫu nhiên)', () => {
    const svc = makeService();
    expect(svc.encrypt('x')).not.toBe(svc.encrypt('x'));
  });

  it('tamper ciphertext → decrypt ném lỗi (GCM auth tag)', () => {
    const svc = makeService();
    const payload = svc.encrypt('sensitive');
    const parts = payload.split(':');
    const ct = Buffer.from(parts[3]!, 'base64');
    ct[0] = ct[0]! ^ 0xff;
    parts[3] = ct.toString('base64');
    expect(() => svc.decrypt(parts.join(':'))).toThrow();
  });

  it('key_id lạ → lỗi rõ ràng', () => {
    const svc = makeService();
    const payload = svc.encrypt('x').replace(/^k1:/, 'k9:');
    expect(() => svc.decrypt(payload)).toThrow(/k9/);
  });

  it('hmacIndex deterministic + 32 bytes', () => {
    const svc = makeService();
    const a = svc.hmacIndex('079123456789');
    expect(a.length).toBe(32);
    expect(a.equals(svc.hmacIndex('079123456789'))).toBe(true);
    expect(a.equals(svc.hmacIndex('079123456788'))).toBe(false);
  });
});
