import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Env validation fail-fast (docs/11 §env): thiếu/sai env → crash ngay khi boot,
 * không để chết giữa chừng lúc runtime.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Connection runtime — app_user (non-superuser, chịu RLS) */
  DATABASE_URL: z.url(),
  /** Connection cho migration tooling — owner; API runtime không dùng */
  DATABASE_URL_MIGRATIONS: z.url().optional(),

  REDIS_URL: z.url(),

  /**
   * Bật cron/worker BullMQ in-process (HOLD expiry, night-audit…). Mặc định bật;
   * test/CI set `false` để worker không poll Redis + không pick job scheduler tồn
   * dư (docs/06 §4, ADR-0002 §5). Tắt KHÔNG ảnh hưởng API — chỉ dừng job nền.
   */
  ENABLE_SCHEDULERS: z.stringbool().default(true),

  /** HMAC secret xác thực webhook thanh toán (Casso/SePay) — task 3.4. Thiếu → từ chối webhook. */
  PAYMENT_WEBHOOK_SECRET: z.string().min(16).optional(),

  /**
   * @deprecated B4 — thay bằng platform-auth module (JWT_PLATFORM_SECRET + đăng nhập
   * platform_users). Không còn dùng để bảo vệ endpoint confirm; giữ lại tạm để không
   * vỡ env cũ. Tài khoản nhận phí nền tảng cho VietQR động (mặc định dev: MB BIN 970422).
   */
  PLATFORM_ADMIN_SECRET: z.string().min(16).optional(),
  PLATFORM_BANK_BIN: z.string().default('970422'),
  PLATFORM_BANK_ACCOUNT: z.string().default('0000000000'),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  /**
   * Platform-auth (B4) — secret ký JWT cho admin nền tảng (bảng platform_users).
   * TÁCH biệt JWT_ACCESS_SECRET (token tenant) để không dùng chéo. Thiếu → endpoint
   * platform (login + confirm thuê bao) trả 503 PLATFORM_AUTH_NOT_CONFIGURED.
   */
  JWT_PLATFORM_SECRET: z.string().min(32).optional(),

  /**
   * Bắt buộc 2FA cho vai trò đặc quyền OWNER/ACCOUNTANT (task 8.4, docs/04 §3).
   * Mặc định TẮT → dev/demo/test không vướng. Bật ở PROD theo mô hình grace-period
   * (giống GitHub org 2FA): sau khi các tài khoản đặc quyền đã enroll 2FA mới bật,
   * vì khi bật, OWNER/ACCOUNTANT chưa bật 2FA sẽ bị chặn đăng nhập (403
   * AUTH_2FA_REQUIRED_FOR_ROLE). Enforce ở /auth/login (không chặn /auth/register
   * — owner mới vẫn nhận session ban đầu để vào enroll 2FA).
   */
  ENFORCE_2FA_FOR_PRIVILEGED_ROLES: z.stringbool().default(false),

  /** Domain cookie refresh (prod: .pmsapp.vn) — dev để trống (host-only) */
  COOKIE_DOMAIN: z.string().optional(),
  /** Base URL web-admin — dựng link reset password */
  APP_WEB_URL: z.url().default('http://localhost:3000'),

  /** ADR-0007: "<key_id>:<base64 32 bytes>" — hỗ trợ key rotation */
  PII_ENC_KEY_CURRENT: z
    .string()
    .regex(/^[\w-]+:[A-Za-z0-9+/]+={0,2}$/, 'định dạng "<key_id>:<base64>"'),
  PII_HMAC_KEY: z.string().min(32),

  S3_ENDPOINT: z.url(),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),

  SENTRY_DSN: z.url().optional(),
  /** Gắn version vào event Sentry (vd git SHA) — set lúc deploy/CI. */
  SENTRY_RELEASE: z.string().min(1).optional(),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),

  /**
   * OCR CCCD/hộ chiếu FPT.AI Vision (task 7.1, docs/12 §3). Thiếu API key →
   * POST /guests/scan-id trả 503 (fallback nhập tay luôn sẵn). Endpoint mặc định
   * idr/vnm (nhận diện giấy tờ VN). Hợp đồng FPT.AI là track lead-time dài (docs/14).
   */
  FPT_AI_API_KEY: z.string().min(1).optional(),
  FPT_AI_ENDPOINT: z.url().default('https://api.fpt.ai/vision/idr/vnm'),
});

export type Env = z.infer<typeof envSchema>;

/** Injection token cho env đã validate. */
export const ENV = Symbol('ENV');

/**
 * Load .env (cwd trước, root monorepo sau — chạy từ apps/api lẫn từ root đều được)
 * rồi validate. Gọi MỘT lần ở đầu bootstrap.
 */
export function loadEnv(): Env {
  const candidates = [join(process.cwd(), '.env'), join(process.cwd(), '../../.env')];
  for (const path of candidates) {
    if (existsSync(path)) {
      dotenv.config({ path });
      break;
    }
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Env không hợp lệ — dừng boot (docs/11 §env):');
    for (const issue of parsed.error.issues) {
      console.error(`   ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}
