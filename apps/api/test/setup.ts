import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as dotenv from 'dotenv';

// Ưu tiên .env của repo root (cwd khi chạy vitest = apps/api)
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
}

// Default cho local/CI — khớp docker-compose.dev.yml; chỉ điền khi thiếu
process.env.DATABASE_URL ??= 'postgresql://app_user:app_password@localhost:5432/pms';
process.env.DATABASE_URL_MIGRATIONS ??= 'postgresql://postgres:postgres@localhost:5432/pms';
process.env.REDIS_URL ??= 'redis://localhost:6379/0';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-0123456789-0123456789';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-0123456789-012345678';
process.env.PII_ENC_KEY_CURRENT ??= 'k1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.PII_HMAC_KEY ??= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.S3_ENDPOINT ??= 'http://localhost:9000';
process.env.S3_BUCKET ??= 'pms-test';
process.env.S3_ACCESS_KEY ??= 'test';
process.env.S3_SECRET_KEY ??= 'test';
process.env.OTEL_ENABLED ??= 'false';
// Tắt cron/worker BullMQ trong test (ÉP CỨNG — kể cả .env bật): worker không
// poll Redis, không chạy nền đua với test. Test gọi sweepExpiredHolds() trực tiếp.
process.env.ENABLE_SCHEDULERS = 'false';
