import { Injectable } from '@nestjs/common';
import {
  type BookingResponse,
  type CancelBookingRequest,
  type CreateBookingRequest,
  type JwtClaims,
  type OffsetPageInfo,
  type UpdateBookingRequest,
} from '@pms/shared-types';
import { Prisma, type bookings } from '@prisma/client';
import { PermissionService } from '@core/auth/permission.service';
import { DocumentCounterService, periodOf } from '@core/counters/document-counter.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { OccupancyService } from '@modules/occupancy/occupancy.service';
import { PricingService } from '@modules/pricing/pricing.service';
import { offsetToSkipTake } from '@/shared/dto';
import { assertTransition, isTerminal } from './booking-status-machine';

const HOLD_TTL_MS = 10 * 60 * 1000; // docs/06 §4

function toBookingResponse(b: bookings): BookingResponse {
  return {
    id: b.id,
    property_id: b.property_id,
    resource_id: b.resource_id,
    guest_id: b.guest_id,
    booking_code: b.booking_code,
    source: b.source,
    status: b.status,
    mode: b.mode,
    rate_plan_id: b.rate_plan_id,
    quote_id: b.quote_id,
    check_in: b.check_in.toISOString(),
    check_out: b.check_out.toISOString(),
    actual_check_in: b.actual_check_in ? b.actual_check_in.toISOString() : null,
    actual_check_out: b.actual_check_out ? b.actual_check_out.toISOString() : null,
    adults: b.adults,
    children: b.children,
    total_amount_vnd: Number(b.total_amount_vnd),
    commission_vnd: Number(b.commission_vnd),
    notes: b.notes,
    cancellation_reason: b.cancellation_reason,
    cancelled_at: b.cancelled_at ? b.cancelled_at.toISOString() : null,
    expires_at: b.expires_at ? b.expires_at.toISOString() : null,
    version: b.version,
    created_at: b.created_at.toISOString(),
    updated_at: b.updated_at.toISOString(),
  };
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly occupancy: OccupancyService,
    private readonly pricing: PricingService,
    private readonly counters: DocumentCounterService,
  ) {}

  /**
   * ★ createBookingTx — ĐƯỜNG GHI DUY NHẤT (docs/06 §3): advisory lock sorted
   * member rooms → verify quote (re-calc) → pre-check overlaps → insert booking +
   * occupancy (EXCLUDE chốt chặn cuối) + status history, cùng MỘT transaction.
   */
  async create(dto: CreateBookingRequest, user: JwtClaims): Promise<BookingResponse> {
    const resource = await this.loadResource(dto.resource_id, user);
    await this.permissionService.authorizeOnProperty(user, resource.property_id, 'booking.create');
    const checkIn = new Date(dto.check_in);
    const checkOut = new Date(dto.check_out);

    const booking = await withTenant(this.prisma, user.tnt, async (tx) => {
      // 1. verify quote (lệch/hết hạn → 409 PRICE_CHANGED)
      const quote = await this.pricing.verifyQuoteForBooking(tx, dto.quote_id, {
        resourceId: resource.id,
        checkIn,
        checkOut,
        mode: dto.mode,
      });

      // 2. phòng thành viên + advisory lock (sorted, tránh deadlock WHOLE↔ROOM)
      const members = await this.occupancy.memberRooms(tx, resource.id);
      if (members.length === 0) {
        throw new AppException({
          code: 'RESOURCE_NO_ROOMS',
          title: 'Resource chưa có phòng thành viên',
          status: 422,
        });
      }
      await this.occupancy.lockRooms(tx, members.map((m) => m.room_id));

      // 3. pre-check overlaps (UX) — EXCLUDE vẫn là guarantee
      const conflicts = await this.occupancy.findOverlaps(
        tx,
        members.map((m) => m.room_id),
        checkIn,
        checkOut,
      );
      if (conflicts.length > 0) {
        throw new AppException({
          code: 'BOOKING_OVERLAP',
          title: 'Phòng đã có khách đặt/chặn trong khoảng này',
          status: 409,
          detail: `${conflicts.length} khoảng chồng lấn`,
        });
      }

      // 4. booking_code atomic
      const code = await this.counters.nextCode(tx, user.tnt, 'BK', periodOf(new Date()));

      // 5. insert booking
      const status = dto.hold ? 'HOLD' : 'PENDING';
      const booking = await tx.bookings.create({
        data: {
          tenant_id: user.tnt,
          property_id: resource.property_id,
          resource_id: resource.id,
          guest_id: dto.guest_id,
          booking_code: code,
          source: dto.source ?? 'DIRECT',
          status,
          mode: dto.mode,
          rate_plan_id: quote.rate_plan_id,
          quote_id: quote.id,
          check_in: checkIn,
          check_out: checkOut,
          adults: dto.adults ?? 1,
          children: dto.children ?? 0,
          total_amount_vnd: quote.total_vnd,
          notes: dto.notes,
          created_by: user.sub,
          ...(dto.hold ? { expires_at: new Date(Date.now() + HOLD_TTL_MS) } : {}),
        },
      });

      // 6. occupancy (EXCLUDE → 23P01 → 409 nếu race vượt pre-check)
      await this.occupancy.insertForBooking(tx, {
        tenantId: user.tnt,
        bookingId: booking.id,
        members,
        checkIn,
        checkOut,
      });

      // 7. status history + đánh dấu quote đã dùng
      await tx.booking_status_history.create({
        data: { tenant_id: user.tnt, booking_id: booking.id, to_status: status, changed_by: user.sub },
      });
      await tx.quotes.update({ where: { id: quote.id }, data: { used_by_booking_id: booking.id } });
      // TODO(task 4.3): outbox.publish(tx, 'booking.created', booking)
      return booking;
    });

    return toBookingResponse(booking);
  }

  async list(
    user: JwtClaims,
    query: {
      property_id?: string;
      status?: string;
      from?: string;
      to?: string;
      page: number;
      page_size: number;
    },
  ): Promise<{ data: BookingResponse[]; page_info: OffsetPageInfo }> {
    const where: Prisma.bookingsWhereInput = {};
    if (query.property_id) {
      await this.permissionService.authorizeOnProperty(user, query.property_id, 'booking.read');
      where.property_id = query.property_id;
    } else if (user.rol !== 'OWNER') {
      // property scope server-side: chỉ booking thuộc property user có role
      const accessible = await withTenant(
        this.prisma,
        user.tnt,
        (tx) =>
          tx.user_property_roles.findMany({
            where: { user_id: user.sub },
            select: { property_id: true },
          }),
        { readOnly: true },
      );
      where.property_id = { in: accessible.map((r) => r.property_id) };
    }
    if (query.status) where.status = query.status as never;
    if (query.from || query.to) {
      where.check_in = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    const { skip, take } = offsetToSkipTake(query);

    const { rows, total } = await withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const [rows, total] = await Promise.all([
          tx.bookings.findMany({ where, orderBy: { created_at: 'desc' }, skip, take }),
          tx.bookings.count({ where }),
        ]);
        return { rows, total };
      },
      { readOnly: true },
    );

    return {
      data: rows.map(toBookingResponse),
      page_info: {
        page: query.page,
        page_size: query.page_size,
        total_items: total,
        total_pages: Math.max(1, Math.ceil(total / query.page_size)),
      },
    };
  }

  async getById(id: string, user: JwtClaims): Promise<BookingResponse> {
    const booking = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, booking.property_id, 'booking.read');
    return toBookingResponse(booking);
  }

  /** PATCH — sửa guest/adults/children/notes (If-Match version); không đổi occupancy. */
  async update(
    id: string,
    expectedVersion: number,
    dto: UpdateBookingRequest,
    user: JwtClaims,
  ): Promise<BookingResponse> {
    const booking = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, booking.property_id, 'booking.update');
    if (isTerminal(booking.status)) {
      throw new AppException({
        code: 'BOOKING_INVALID_STATUS',
        title: `Booking ${booking.status} không thể sửa`,
        status: 422,
      });
    }
    const updated = await withTenant(this.prisma, user.tnt, async (tx) => {
      const result = await tx.bookings.updateMany({
        where: { id, version: expectedVersion },
        data: {
          guest_id: dto.guest_id,
          adults: dto.adults,
          children: dto.children,
          notes: dto.notes,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) {
        throw new AppException({
          code: 'VERSION_CONFLICT',
          title: 'Booking đã bị sửa bởi người khác — tải lại rồi thử lại',
          status: 409,
        });
      }
      return tx.bookings.findFirstOrThrow({ where: { id } });
    });
    return toBookingResponse(updated);
  }

  /** Huỷ booking → CANCELLED + xoá occupancy CÙNG tx (docs/06 §2). */
  async cancel(id: string, dto: CancelBookingRequest, user: JwtClaims): Promise<BookingResponse> {
    const booking = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, booking.property_id, 'booking.cancel');
    assertTransition(booking.status, 'CANCELLED');

    const updated = await withTenant(this.prisma, user.tnt, async (tx) => {
      const row = await tx.bookings.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancellation_reason: dto.reason,
          cancelled_at: new Date(),
          cancelled_by: user.sub,
          version: { increment: 1 },
        },
      });
      await this.occupancy.deleteForBooking(tx, id);
      await tx.booking_status_history.create({
        data: {
          tenant_id: user.tnt,
          booking_id: id,
          from_status: booking.status,
          to_status: 'CANCELLED',
          changed_by: user.sub,
          reason: dto.reason,
        },
      });
      return row;
    });
    return toBookingResponse(updated);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async loadResource(
    resourceId: string,
    user: JwtClaims,
  ): Promise<{ id: string; property_id: string }> {
    const resource = await withTenant(
      this.prisma,
      user.tnt,
      (tx) =>
        tx.bookable_resources.findFirst({
          where: { id: resourceId },
          select: { id: true, property_id: true },
        }),
      { readOnly: true },
    );
    if (!resource) {
      throw new AppException({
        code: 'RESOURCE_NOT_FOUND',
        title: 'Resource không tồn tại',
        status: 404,
      });
    }
    return resource;
  }

  private async loadOrThrow(id: string, user: JwtClaims): Promise<bookings> {
    const booking = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.bookings.findFirst({ where: { id } }),
      { readOnly: true },
    );
    if (!booking) {
      throw new AppException({
        code: 'BOOKING_NOT_FOUND',
        title: 'Booking không tồn tại',
        status: 404,
      });
    }
    return booking;
  }
}
