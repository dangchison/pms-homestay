/**
 * Redact PII/bí mật trước khi ghi vào audit_logs (docs/03 §audit_logs, docs/11 §2).
 * Cùng danh sách trường nhạy cảm với pino redact (logger.module) — số giấy tờ,
 * mật khẩu, secret 2FA, token. before_data/after_data KHÔNG bao giờ lưu plaintext.
 */

const CENSOR = '[REDACTED]';
const MAX_DEPTH = 6; // chặn payload lồng sâu (tránh ghi audit phình to)
const MAX_ARRAY = 100;
const MAX_STRING = 2000;

/** Khoá khớp chính xác (đã lowercase). */
const SENSITIVE_EXACT = new Set([
  'password',
  'password_hash',
  'current_password',
  'new_password',
  'old_password',
  'id_document_number',
  'id_document_number_enc',
  'two_factor_secret',
  'totp_secret',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'otp',
  'backup_code',
  'backup_codes',
  'authorization',
  'cookie',
]);

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  if (SENSITIVE_EXACT.has(k)) return true;
  if (k.includes('password')) return true; // *_password, password_*
  if (k.endsWith('secret')) return true; // api_secret, webhook_secret
  return false;
}

/** Trả bản sao đã redact — không đụng input gốc. */
export function redactPii(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return '[TRUNCATED]';

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((v) => redactPii(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? CENSOR : redactPii(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > MAX_STRING) {
    return `${value.slice(0, MAX_STRING)}…`;
  }
  return value;
}
