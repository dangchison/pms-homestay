import { type RedisOptions } from 'ioredis';

/**
 * REDIS_URL → ioredis `RedisOptions` cho BullMQ.
 *
 * BullMQ tạo connection bằng `new IORedis(options)` (dạng object) — và ioredis
 * ở dạng object KHÔNG parse field `url` (chỉ parse khi URL là tham số CHUỖI đầu
 * tiên). Truyền `{ url }` sẽ âm thầm về mặc định `localhost:6379/0`, sai với
 * Redis remote/đổi db. Vì vậy parse URL tường minh tại đây.
 *
 * `maxRetriesPerRequest: null` là BẮT BUỘC cho connection của BullMQ Worker
 * (blocking command BRPOPLPUSH) — thiếu sẽ ném lỗi khi worker khởi động.
 */
export function bullmqConnectionFromUrl(url: string): RedisOptions {
  const u = new URL(url);
  const db = u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0;
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username || undefined,
    password: u.password || undefined,
    db: Number.isFinite(db) ? db : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}
