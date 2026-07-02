import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type Redis from 'ioredis';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { assertWithinRateLimit } from '@core/redis/rate-limit';
import { REDIS } from '@core/redis/redis.module';
import { withTenant } from '@core/tenancy/with-tenant';
import { type BusyInterval, buildIcal, computeBusyEtag } from './ical-builder';

/** Token = encode(gen_random_bytes(24),'hex') = 48 ký tự hex. */
const TOKEN_RE = /^[a-f0-9]{48}$/i;
const RATE_LIMIT = 10; // yêu cầu / cửa sổ / (IP, token)
const RATE_WINDOW_SECONDS = 60;

/** Busy của booking ở các trạng thái này (KHÔNG gồm HOLD — giữ chỗ tạm chưa chắc). */
const BUSY_BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN'];

interface ResolvedToken {
  tenant_id: string;
  resource_id: string;
  property_id: string;
}

interface RawBusyRow {
  booking_id: string | null;
  block_id: string | null;
  start_at: Date;
  end_at: Date;
}

export interface IcalPushResult {
  etag: string;
  body: string;
}

/**
 * iCal PUSH (task 5.3, docs/08 §3 + spec roadmap): phục vụ endpoint công khai
 * `GET /public/sync/ical/:token`. Giải token CROSS-TENANT qua SQL function
 * SECURITY DEFINER `resolve_ical_token` (channel_resource_mappings có FORCE RLS,
 * endpoint không có GUC tenant → phải bypass). Sau khi có tenant_id thì
 * `withTenant` đọc occupancy của các phòng thành viên của resource → khoảng busy
 * (booking PENDING/CONFIRMED/CHECKED_IN + room block, TỪ now). Builder thuần sinh
 * VCALENDAR không PII. Rate limit 10/min/IP/token trên Redis (INCR + EXPIRE).
 */
@Injectable()
export class IcalPushService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** 10/min/(IP, token) — vượt → 429. Áp TRƯỚC khi truy DB để chống abuse. */
  async assertWithinRateLimit(ip: string, token: string): Promise<void> {
    await assertWithinRateLimit(this.redis, `ical:push:${ip}`, token, RATE_LIMIT, RATE_WINDOW_SECONDS);
  }

  /** token → iCal feed + ETag. Token sai/không tồn tại → 404 (không tiết lộ). */
  async getResourceCalendar(token: string, now: Date): Promise<IcalPushResult> {
    if (!TOKEN_RE.test(token)) throw this.notFound();
    const resolved = await this.resolveToken(token);
    if (!resolved) throw this.notFound();

    const intervals = await this.loadBusyIntervals(resolved.tenant_id, resolved.resource_id, now);
    const etag = computeBusyEtag(intervals);
    const body = buildIcal({ calendarName: 'PMS Availability', intervals, dtstamp: now });
    return { etag, body };
  }

  // ── Resolve token (cross-tenant, NGOÀI withTenant — qua SECURITY DEFINER func) ──
  private async resolveToken(token: string): Promise<ResolvedToken | null> {
    const rows = await this.prisma.$queryRaw<ResolvedToken[]>(Prisma.sql`
      SELECT tenant_id::text AS tenant_id,
             resource_id::text AS resource_id,
             property_id::text AS property_id
      FROM resolve_ical_token(${token})
    `);
    return rows[0] ?? null;
  }

  // ── Đọc occupancy của resource (withTenant — RLS áp đủ) ─────────────────────
  private async loadBusyIntervals(
    tenantId: string,
    resourceId: string,
    now: Date,
  ): Promise<BusyInterval[]> {
    const rows = await withTenant(
      this.prisma,
      tenantId,
      (tx) =>
        tx.$queryRaw<RawBusyRow[]>(Prisma.sql`
          SELECT
            ro.booking_id::text AS booking_id,
            ro.block_id::text   AS block_id,
            min(lower(ro.period)) AS start_at,
            max(upper(ro.period)) AS end_at
          FROM room_occupancy ro
          JOIN resource_members rm ON rm.room_id = ro.room_id
          LEFT JOIN bookings b ON b.id = ro.booking_id
          WHERE rm.resource_id = ${resourceId}::uuid
            AND upper(ro.period) > ${now}::timestamptz
            AND (
              ro.block_id IS NOT NULL
              OR b.status::text IN (${Prisma.join(BUSY_BOOKING_STATUSES)})
            )
          GROUP BY ro.booking_id, ro.block_id
          ORDER BY start_at
        `),
      { readOnly: true },
    );

    return rows.map((r) => {
      const isBooking = r.booking_id !== null;
      const id = r.booking_id ?? r.block_id ?? 'unknown';
      return {
        uid: `${isBooking ? 'booking' : 'block'}-${id}@pms-homestay`,
        start: r.start_at,
        end: r.end_at,
        summary: isBooking ? 'Reserved' : 'Blocked',
      };
    });
  }

  private notFound(): AppException {
    return new AppException({ code: 'ICAL_TOKEN_INVALID', title: 'Token không hợp lệ', status: 404 });
  }
}
