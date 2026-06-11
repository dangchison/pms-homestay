import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { EncryptionService } from '@core/crypto/encryption.service';

/** Payload lưu trong users.two_factor_secret (mã hoá AES-256-GCM — ADR-0007). */
interface TwoFactorPayload {
  secret: string;
  /** sha256 hex của backup codes còn hiệu lực (10 × dùng-một-lần — docs/04 §3) */
  backup: string[];
}

const BACKUP_CODE_COUNT = 10;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class TwoFactorService {
  constructor(private readonly encryption: EncryptionService) {}

  /** Sinh secret + backup codes; trả encrypted payload để lưu DB. */
  generateEnrollment(email: string): {
    secret: string;
    otpauthUrl: string;
    backupCodes: string[];
    encryptedPayload: string;
  } {
    const secret = generateSecret();
    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
      randomBytes(4).toString('hex'),
    );
    const payload: TwoFactorPayload = { secret, backup: backupCodes.map(sha256Hex) };
    return {
      secret,
      otpauthUrl: generateURI({ issuer: 'PMS Homestay', label: email, secret }),
      backupCodes,
      encryptedPayload: this.encryption.encrypt(JSON.stringify(payload)),
    };
  }

  /**
   * Verify TOTP 6 số hoặc backup code (một lần).
   * Trả về payload mới nếu backup code bị tiêu thụ (caller lưu lại DB).
   */
  verify(
    encryptedPayload: string,
    code: string,
  ): { ok: boolean; updatedPayload?: string } {
    const payload = JSON.parse(this.encryption.decrypt(encryptedPayload)) as TwoFactorPayload;

    if (/^\d{6}$/.test(code)) {
      return { ok: verifySync({ token: code, secret: payload.secret }).valid };
    }

    const hash = sha256Hex(code.toLowerCase());
    if (payload.backup.includes(hash)) {
      const updated: TwoFactorPayload = {
        secret: payload.secret,
        backup: payload.backup.filter((h) => h !== hash),
      };
      return { ok: true, updatedPayload: this.encryption.encrypt(JSON.stringify(updated)) };
    }
    return { ok: false };
  }
}
