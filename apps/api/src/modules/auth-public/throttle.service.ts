import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '@core/redis/redis.module';

const WINDOW_SECONDS = 15 * 60;

/** Ngưỡng theo docs/04 §3 — account-first (nhận thức CGNAT VN). */
export const ACCOUNT_FAIL_LIMIT = 5; // → lock account 30'
export const IP_FAIL_LIMIT = 30; // → yêu cầu captcha, KHÔNG khoá cứng
export const ACCOUNT_LOCK_MINUTES = 30;

/**
 * Đếm fail login trong cửa sổ 15' trên Redis.
 * Khoá account ghi vào users.locked_until (AuthService đảm nhiệm).
 */
@Injectable()
export class ThrottleService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private acctKey(tenantId: string, email: string): string {
    return `auth:fail:acct:${tenantId}:${email.toLowerCase()}`;
  }

  private ipKey(ip: string): string {
    return `auth:fail:ip:${ip}`;
  }

  /** Ghi nhận 1 lần fail; trả về số fail hiện tại của account + IP. */
  async recordFailure(
    tenantId: string,
    email: string,
    ip: string,
  ): Promise<{ accountFails: number; ipFails: number }> {
    const [accountFails, ipFails] = await Promise.all([
      this.incrWithWindow(this.acctKey(tenantId, email)),
      this.incrWithWindow(this.ipKey(ip)),
    ]);
    return { accountFails, ipFails };
  }

  async clearAccountFailures(tenantId: string, email: string): Promise<void> {
    await this.redis.del(this.acctKey(tenantId, email));
  }

  /** IP vượt ngưỡng → bước captcha (Turnstile — wire thật ở task 8.4). */
  async ipRequiresCaptcha(ip: string): Promise<boolean> {
    const count = await this.redis.get(this.ipKey(ip));
    return Number(count ?? 0) >= IP_FAIL_LIMIT;
  }

  private async incrWithWindow(key: string): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, WINDOW_SECONDS);
    return count;
  }
}
