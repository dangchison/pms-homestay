import type Redis from 'ioredis';
import { AppException } from '@core/http/exceptions/app.exception';

/**
 * Rate-limit trượt cửa sổ dùng chung (Redis INCR + EXPIRE) cho các endpoint
 * public: `ical-push.service`, `mock-gateway.controller`, ... Key = `${keyPrefix}:${id}`
 * (id thường gồm IP + định danh tài nguyên như token/paymentRef). Lần đầu đặt TTL
 * = windowSeconds; vượt `limit` trong cửa sổ → ném 429 `RATE_LIMITED`.
 *
 * Áp TRƯỚC khi truy DB để chống lạm dụng. Giữ prefix + limit/window là tham số
 * để mỗi endpoint tự chọn ngưỡng riêng.
 */
export async function assertWithinRateLimit(
  redis: Redis,
  keyPrefix: string,
  id: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const key = `${keyPrefix}:${id}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  if (count > limit) {
    throw new AppException({
      code: 'RATE_LIMITED',
      title: 'Quá nhiều yêu cầu — thử lại sau ít phút',
      status: 429,
    });
  }
}
