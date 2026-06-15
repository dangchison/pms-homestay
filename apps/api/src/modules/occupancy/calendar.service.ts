import { Injectable } from '@nestjs/common';
import {
  type CalendarBlock,
  type CalendarBooking,
  type CalendarOccupancyQuery,
  type CalendarOccupancyResponse,
  type CalendarResource,
  type HousekeepingStatus,
  type JwtClaims,
} from '@pms/shared-types';
import { Prisma } from '@prisma/client';
import { PermissionService } from '@core/auth/permission.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';

interface RawResource {
  id: string;
  property_id: string;
  type: string;
  name: string;
  is_active: boolean;
  room_ids: string[];
  housekeeping_status: string | null;
  room_number: string | null;
}

interface RawBooking {
  id: string;
  resource_id: string;
  booking_code: string;
  status: string;
  mode: string;
  source: string;
  check_in: Date;
  check_out: Date;
  occupancy_start: Date;
  occupancy_end: Date;
  guest_name: string | null;
  adults: number;
  children: number;
  total_amount_vnd: bigint;
  version: number;
  is_whole: boolean;
}

interface RawBlock {
  id: string;
  resource_id: string;
  room_id: string;
  start_at: Date;
  end_at: Date;
  reason: string;
}

/**
 * CalendarService (task 6.2, spec ui/01 #C1) — đọc-only cho timeline phòng×ngày.
 * Trục Y = bookable_resources (WHOLE trước), trục X = ngày. Nguồn sự thật là
 * `room_occupancy` (presence-based) JOIN bookings/blocks để tóm tắt — KHÔNG tự
 * suy từ bookings (đảm bảo phản ánh đúng cả block + buffer + loại terminal).
 * Pha-1 `booking.read` (controller) + pha-2 authorizeOnProperty (property-scope).
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
  ) {}

  async getOccupancy(
    query: CalendarOccupancyQuery,
    user: JwtClaims,
  ): Promise<CalendarOccupancyResponse> {
    await this.assertPropertyExists(query.property_id, user);
    await this.permissionService.authorizeOnProperty(user, query.property_id, 'booking.read');

    const from = new Date(query.from);
    const to = new Date(query.to);

    return withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const [resources, bookings, blocks] = await Promise.all([
          this.loadResources(tx, query.property_id),
          this.loadBookings(tx, query.property_id, from, to),
          this.loadBlocks(tx, query.property_id, from, to),
        ]);
        return { property_id: query.property_id, from: query.from, to: query.to, resources, bookings, blocks };
      },
      { readOnly: true },
    );
  }

  /** Hàng trục Y: resource active của cơ sở + dot housekeeping cho ROOM (1 phòng). */
  private async loadResources(tx: Prisma.TransactionClient, propertyId: string): Promise<CalendarResource[]> {
    const rows = await tx.$queryRaw<RawResource[]>(Prisma.sql`
      SELECT
        br.id::text          AS id,
        br.property_id::text AS property_id,
        br.type::text        AS type,
        br.name              AS name,
        br.is_active         AS is_active,
        COALESCE(
          array_agg(rm.room_id::text ORDER BY rm.room_id) FILTER (WHERE rm.room_id IS NOT NULL),
          ARRAY[]::text[]
        )                    AS room_ids,
        CASE WHEN br.type = 'ROOM' THEN max(rk.housekeeping_status::text) END AS housekeeping_status,
        CASE WHEN br.type = 'ROOM' THEN max(rk.room_number)                END AS room_number
      FROM bookable_resources br
      LEFT JOIN resource_members rm ON rm.resource_id = br.id
      LEFT JOIN rooms rk ON rk.id = rm.room_id AND rk.deleted_at IS NULL
      WHERE br.property_id = ${propertyId}::uuid AND br.deleted_at IS NULL
      GROUP BY br.id, br.property_id, br.type, br.name, br.is_active
      ORDER BY (br.type = 'WHOLE') DESC, br.name
    `);
    return rows.map((r) => ({
      id: r.id,
      property_id: r.property_id,
      type: r.type as CalendarResource['type'],
      name: r.name,
      is_active: r.is_active,
      room_ids: r.room_ids,
      housekeeping_status: (r.housekeeping_status as HousekeepingStatus | null) ?? null,
      room_number: r.room_number,
    }));
  }

  /** Booking còn occupancy chồng [from,to): HOLD/PENDING/CONFIRMED/CHECKED_IN (terminal đã xoá occupancy). */
  private async loadBookings(
    tx: Prisma.TransactionClient,
    propertyId: string,
    from: Date,
    to: Date,
  ): Promise<CalendarBooking[]> {
    const rows = await tx.$queryRaw<RawBooking[]>(Prisma.sql`
      SELECT
        b.id::text          AS id,
        b.resource_id::text AS resource_id,
        b.booking_code      AS booking_code,
        b.status::text      AS status,
        b.mode::text        AS mode,
        b.source            AS source,
        b.check_in          AS check_in,
        b.check_out         AS check_out,
        min(lower(ro.period)) AS occupancy_start,
        max(upper(ro.period)) AS occupancy_end,
        g.full_name         AS guest_name,
        b.adults            AS adults,
        b.children          AS children,
        b.total_amount_vnd::bigint AS total_amount_vnd,
        b.version           AS version,
        (br.type = 'WHOLE') AS is_whole
      FROM bookings b
      JOIN room_occupancy ro ON ro.booking_id = b.id
      JOIN bookable_resources br ON br.id = b.resource_id
      LEFT JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
      WHERE b.property_id = ${propertyId}::uuid
        AND ro.period && tstzrange(${from}, ${to}, '[)')
      GROUP BY b.id, b.resource_id, b.booking_code, b.status, b.mode, b.source,
               b.check_in, b.check_out, g.full_name, b.adults, b.children,
               b.total_amount_vnd, b.version, br.type
      ORDER BY b.check_in
    `);
    return rows.map((r) => ({
      id: r.id,
      resource_id: r.resource_id,
      booking_code: r.booking_code,
      status: r.status as CalendarBooking['status'],
      mode: r.mode as CalendarBooking['mode'],
      source: r.source,
      check_in: r.check_in.toISOString(),
      check_out: r.check_out.toISOString(),
      occupancy_start: r.occupancy_start.toISOString(),
      occupancy_end: r.occupancy_end.toISOString(),
      guest_name: r.guest_name,
      adults: r.adults,
      children: r.children,
      total_amount_vnd: Number(r.total_amount_vnd),
      version: r.version,
      is_whole: r.is_whole,
    }));
  }

  /** Room block chồng [from,to) → 1 dòng cho MỖI resource chứa phòng bị chặn. */
  private async loadBlocks(
    tx: Prisma.TransactionClient,
    propertyId: string,
    from: Date,
    to: Date,
  ): Promise<CalendarBlock[]> {
    const rows = await tx.$queryRaw<RawBlock[]>(Prisma.sql`
      SELECT
        rb.id::text      AS id,
        br.id::text      AS resource_id,
        rb.room_id::text AS room_id,
        rb.start_at      AS start_at,
        rb.end_at        AS end_at,
        rb.reason        AS reason
      FROM room_blocks rb
      JOIN room_occupancy ro ON ro.block_id = rb.id
      JOIN resource_members rm ON rm.room_id = rb.room_id
      JOIN bookable_resources br
        ON br.id = rm.resource_id AND br.property_id = ${propertyId}::uuid AND br.deleted_at IS NULL
      WHERE ro.period && tstzrange(${from}, ${to}, '[)')
      GROUP BY rb.id, br.id, rb.room_id, rb.start_at, rb.end_at, rb.reason
      ORDER BY rb.start_at
    `);
    return rows.map((r) => ({
      id: r.id,
      resource_id: r.resource_id,
      room_id: r.room_id,
      start_at: r.start_at.toISOString(),
      end_at: r.end_at.toISOString(),
      reason: r.reason,
    }));
  }

  private async assertPropertyExists(propertyId: string, user: JwtClaims): Promise<void> {
    const found = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.properties.findFirst({ where: { id: propertyId }, select: { id: true } }),
      { readOnly: true },
    );
    if (!found) {
      throw new AppException({
        code: 'PROPERTY_NOT_FOUND',
        title: 'Không tìm thấy cơ sở',
        status: 404,
      });
    }
  }
}
