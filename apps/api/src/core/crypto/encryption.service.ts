import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '@core/config/env.schema';

const ALG = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * ★ EncryptionService (ADR-0007) — đường DUY NHẤT đọc/ghi field PII mã hoá:
 * users.two_factor_secret, guests.id_document_number_enc (task 2.5),
 * channels.config secret (task 5.1). CẤM module khác tự decrypt.
 *
 * - AES-256-GCM, payload `<key_id>:<iv b64>:<tag b64>:<ct b64>` — key_id cho
 *   phép rotate key (key mới ở PII_ENC_KEY_CURRENT, key cũ giữ để decrypt
 *   qua PII_ENC_KEYS_RETIRED — thêm env khi rotate lần đầu).
 * - Blind index: HMAC-SHA256 với KHOÁ RIÊNG (PII_HMAC_KEY — không dùng chung
 *   khoá mã hoá), phục vụ exact-match search (ADR-0007 §2).
 */
@Injectable()
export class EncryptionService {
  private readonly keys = new Map<string, Buffer>();
  private readonly currentKeyId: string;
  private readonly hmacKey: Buffer;

  constructor(@Inject(ENV) env: Env) {
    const [keyId, keyB64] = splitKeySpec(env.PII_ENC_KEY_CURRENT);
    const key = Buffer.from(keyB64, 'base64');
    if (key.length !== 32) {
      throw new Error(`PII_ENC_KEY_CURRENT: key phải đúng 32 bytes, nhận ${key.length}`);
    }
    this.currentKeyId = keyId;
    this.keys.set(keyId, key);

    this.hmacKey = Buffer.from(env.PII_HMAC_KEY, 'base64');
    if (this.hmacKey.length < 32) {
      throw new Error('PII_HMAC_KEY: khoá HMAC phải >= 32 bytes (base64)');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALG, this.keys.get(this.currentKeyId)!, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      this.currentKeyId,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 4) throw new Error('EncryptionService.decrypt: payload sai định dạng');
    const [keyId, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`EncryptionService.decrypt: không có key "${keyId}" (đã rotate?)`);

    const decipher = createDecipheriv(ALG, key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(), // ném lỗi nếu tag không khớp (tamper)
    ]).toString('utf8');
  }

  /** Blind index exact-match (ADR-0007): HMAC-SHA256(giá trị đã chuẩn hoá). */
  hmacIndex(normalized: string): Buffer {
    return createHmac('sha256', this.hmacKey).update(normalized, 'utf8').digest();
  }
}

function splitKeySpec(spec: string): [string, string] {
  const idx = spec.indexOf(':');
  if (idx <= 0) throw new Error('PII_ENC_KEY_CURRENT: định dạng "<key_id>:<base64 32B>"');
  return [spec.slice(0, idx), spec.slice(idx + 1)];
}
