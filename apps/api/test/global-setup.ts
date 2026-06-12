import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as dotenv from 'dotenv';
import Redis from 'ioredis';

const TEST_REDIS_DB = '1';

/**
 * Chạy MỘT lần trước mọi fork test (vitest globalSetup). Flush Redis db DÀNH
 * RIÊNG cho test (db 1, tách hẳn db 0 của dev) để mỗi lần chạy bắt đầu sạch:
 * - reset đếm throttle `auth:fail:ip:*` (ngưỡng 30/15') → không tích luỹ chéo
 *   các lần chạy gây 429 ngẫu nhiên (nguồn flake e2e đã truy);
 * - xoá job scheduler BullMQ tồn dư, cache permission, pv… còn sót.
 * Không flush ở setup.ts (per-fork) — sẽ xoá state của fork khác đang chạy.
 */
export default async function globalSetup(): Promise<void> {
  const rootEnv = resolve(process.cwd(), '../../.env');
  if (existsSync(rootEnv)) dotenv.config({ path: rootEnv });

  const base = process.env.REDIS_URL ?? 'redis://localhost:6379/0';
  const url = new URL(base);
  url.pathname = `/${TEST_REDIS_DB}`;

  const redis = new Redis(url.toString());
  await redis.flushdb();
  await redis.quit();
}
