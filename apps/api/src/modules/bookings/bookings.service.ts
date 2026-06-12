import { Injectable } from '@nestjs/common';
import {
  type BookingResponse,
  type BookingStatus,
  type CancelBookingRequest,
  type ConfirmBookingRequest,
  type CreateBookingRequest,
  type JwtClaims,
  type OffsetPageInfo,
  type SwitchResourceRequest,
  type UpdateBookingRequest,
} from '@pms/shared-types';
import { Prisma, type bookings } from '@prisma/client';
import { PermissionService } from '@core/auth/permission.service';
import { DocumentCounterService, periodOf } from '@core/counters/document-counter.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { OccupancyService } from '@modules/occupancy/occupancy.service';
import { ExpensesService } from '@modules/expenses/expenses.service';
import { InvoicesService } from '@modules/invoices/invoices.service';
import { PricingService } from '@modules/pricing/pricing.service';
import { offsetToSkipTake } from '@/shared/dto';
import { assertTransition, isTerminal } from './booking-status-machine';

const HOLD_TTL_MS = 10 * 60 * 1000; // docs/06 §4
const DEPOSIT_DEADLINE_HOURS = 24; // hạn cọc PENDING (docs/06 §4) — per-tenant config: task 4.7
/** Trần số HOLD huỷ mỗi tenant mỗi lượt quét — chống tx dài; backlog dọn ở lượt sau. */
const HOLD_SWEEP_BATCH = 500;

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
    private readonly invoices: InvoicesService,
    private readonly expenses: ExpensesService,
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

      // Vào thẳng PENDING (không HOLD) → issue DEPOSIT invoice ngay (docs/09 §3)
      if (status === 'PENDING') await this.invoices.issueDepositForBooking(tx, booking);
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

  /**
   * Xác nhận booking (docs/06 §4, task 2.7). Mặc định HOLD → PENDING + đặt hạn
   * cọc (`expires_at = now + 24h`; night-audit 4.6 dọn PENDING quá hạn). `force`
   * (CHỈ OWNER) → CONFIRMED luôn, bỏ qua bước cọc — dùng khi nhận tiền ngoài luồng.
   *
   * TODO(task 3.2): PENDING → phát hành DEPOSIT invoice theo deposit_type/value;
   * deposit_type=NONE → auto CONFIRMED ngay.
   */
  async confirm(id: string, dto: ConfirmBookingRequest, user: JwtClaims): Promise<BookingResponse> {
    const booking = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, booking.property_id, 'booking.update');

    if (dto.force && user.rol !== 'OWNER') {
      throw new AppException({
        code: 'FORBIDDEN',
        title: 'Chỉ OWNER được xác nhận thẳng (force) — bỏ qua bước cọc',
        status: 403,
      });
    }

    const target: BookingStatus = dto.force ? 'CONFIRMED' : 'PENDING';
    assertTransition(booking.status, target); // HOLD→PENDING|CONFIRMED, PENDING→CONFIRMED; else 422
    const expiresAt =
      target === 'PENDING' ? new Date(Date.now() + DEPOSIT_DEADLINE_HOURS * 3_600_000) : null;

    const updated = await withTenant(this.prisma, user.tnt, async (tx) => {
      // điều kiện theo status hiện tại → tránh đua với cron expiry (HOLD vừa bị huỷ)
      const result = await tx.bookings.updateMany({
        where: { id, status: booking.status },
        data: { status: target, expires_at: expiresAt, version: { increment: 1 } },
      });
      if (result.count === 0) {
        throw new AppException({
          code: 'BOOKING_INVALID_STATUS',
          title: 'Booking đã đổi trạng thái — tải lại rồi thử lại',
          status: 409,
        });
      }
      await tx.booking_status_history.create({
        data: {
          tenant_id: user.tnt,
          booking_id: id,
          from_status: booking.status,
          to_status: target,
          changed_by: user.sub,
        },
      });
      // HOLD → PENDING: issue DEPOSIT invoice (docs/09 §3) — khách thanh toán để CONFIRMED
      if (target === 'PENDING') await this.invoices.issueDepositForBooking(tx, booking);
      // TODO(task 4.3): outbox.publish(tx, 'booking.confirmed', booking)
      return tx.bookings.findFirstOrThrow({ where: { id } });
    });
    return toBookingResponse(updated);
  }

  /**
   * Cọc PAID → booking PENDING tự CONFIRMED (docs/09 §3). Gọi bởi PaymentsService
   * (task 3.3) TRONG tx ghi payment, sau khi trigger đẩy DEPOSIT invoice → PAID.
   * Idempotent (chỉ đổi khi đang PENDING) — chạy lại / OWNER đã force → no-op.
   */
  async confirmFromDepositPaid(
    tx: Prisma.TransactionClient,
    bookingId: string,
    tenantId: string,
    actorUserId: string | null,
  ): Promise<void> {
    const result = await tx.bookings.updateMany({
      where: { id: bookingId, status: 'PENDING' },
      data: { status: 'CONFIRMED', expires_at: null, version: { increment: 1 } },
    });
    if (result.count > 0) {
      await tx.booking_status_history.create({
        data: {
          tenant_id: tenantId,
          booking_id: bookingId,
          from_status: 'PENDING',
          to_status: 'CONFIRMED',
          changed_by: actorUserId,
          reason: 'Cọc đã thanh toán',
        },
      });
    }
  }

  /** Check-in (docs/06, task 2.8) — chỉ CONFIRMED → CHECKED_IN, ghi actual_check_in. */
  async checkIn(id: string, user: JwtClaims): Promise<BookingResponse> {
    const booking = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, booking.property_id, 'booking.checkin_out');
    assertTransition(booking.status, 'CHECKED_IN'); // chỉ CONFIRMED hợp lệ; else 422

    const updated = await withTenant(this.prisma, user.tnt, async (tx) => {
      const result = await tx.bookings.updateMany({
        where: { id, status: 'CONFIRMED' },
        data: { status: 'CHECKED_IN', actual_check_in: new Date(), version: { increment: 1 } },
      });
      if (result.count === 0) {
        throw new AppException({
          code: 'BOOKING_INVALID_STATUS',
          title: 'Booking đã đổi trạng thái — tải lại rồi thử lại',
          status: 409,
        });
      }
      await tx.booking_status_history.create({
        data: {
          tenant_id: user.tnt,
          booking_id: id,
          from_status: 'CONFIRMED',
          to_status: 'CHECKED_IN',
          changed_by: user.sub,
        },
      });
      return tx.bookings.findFirstOrThrow({ where: { id } });
    });
    return toBookingResponse(updated);
  }

  /**
   * Check-out (docs/06, task 2.8) — CHECKED_IN → CHECKED_OUT, ghi actual_check_out
   * + **xoá occupancy** (giải phóng phòng) CÙNG tx.
   *
   * TODO(task 3.2): finalize STAY invoice (items từ quote snapshot + phụ thu +
   * DEPOSIT_APPLIED). TODO(task 4.1): sinh cleaning task. Stub event tới khi có.
   */
  async checkOut(id: string, user: JwtClaims): Promise<BookingResponse> {
    const booking = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, booking.property_id, 'booking.checkin_out');
    assertTransition(booking.status, 'CHECKED_OUT'); // chỉ CHECKED_IN hợp lệ; else 422

    const updated = await withTenant(this.prisma, user.tnt, async (tx) => {
      const result = await tx.bookings.updateMany({
        where: { id, status: 'CHECKED_IN' },
        data: { status: 'CHECKED_OUT', actual_check_out: new Date(), version: { increment: 1 } },
      });
      if (result.count === 0) {
        throw new AppException({
          code: 'BOOKING_INVALID_STATUS',
          title: 'Booking đã đổi trạng thái — tải lại rồi thử lại',
          status: 409,
        });
      }
      await this.occupancy.deleteForBooking(tx, id);
      await tx.booking_status_history.create({
        data: {
          tenant_id: user.tnt,
          booking_id: id,
          from_status: 'CHECKED_IN',
          to_status: 'CHECKED_OUT',
          changed_by: user.sub,
        },
      });
      // Finalize STAY invoice (docs/09 §4.3): items từ quote + cấn cọc đã thu
      await this.invoices.issueStayForBooking(tx, booking);
      // Auto-sinh hoa hồng OTA (docs/09 §6, task 3.6) — idempotent qua partial unique
      await this.expenses.createOtaCommissionForBooking(tx, booking);
      return tx.bookings.findFirstOrThrow({ where: { id } });
    });
    return toBookingResponse(updated);
  }

  /**
   * Đổi resource (docs/06 §6, task 2.8) — occupancy delete (cũ) + reinsert (mới)
   * trong MỘT tx; EXCLUDE chặn nếu phòng mới bận (→ 409). Resource mới phải cùng
   * property. Lock union phòng cũ∪mới (sorted) chống deadlock. Không đổi status.
   *
   * TODO(task 4.1): sinh cleaning task cho phòng cũ. TODO(task 4.5): audit log.
   */
  async switchResource(
    id: string,
    dto: SwitchResourceRequest,
    user: JwtClaims,
  ): Promise<BookingResponse> {
    const booking = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(
      user,
      booking.property_id,
      'booking.switch_resource',
    );
    if (isTerminal(booking.status)) {
      throw new AppException({
        code: 'BOOKING_INVALID_STATUS',
        title: `Booking ${booking.status} không thể đổi phòng`,
        status: 422,
      });
    }
    if (dto.new_resource_id === booking.resource_id) {
      throw new AppException({
        code: 'BOOKING_SAME_RESOURCE',
        title: 'Resource mới trùng resource hiện tại',
        status: 422,
      });
    }
    const newResource = await this.loadResource(dto.new_resource_id, user);
    if (newResource.property_id !== booking.property_id) {
      throw new AppException({
        code: 'RESOURCE_PROPERTY_MISMATCH',
        title: 'Resource mới phải cùng cơ sở với booking',
        status: 422,
      });
    }

    const updated = await withTenant(this.prisma, user.tnt, async (tx) => {
      const oldMembers = await this.occupancy.memberRooms(tx, booking.resource_id);
      const newMembers = await this.occupancy.memberRooms(tx, newResource.id);
      if (newMembers.length === 0) {
        throw new AppException({
          code: 'RESOURCE_NO_ROOMS',
          title: 'Resource mới chưa có phòng thành viên',
          status: 422,
        });
      }
      // lock union phòng cũ ∪ mới (sorted) — serialize với request đụng cùng phòng
      const lockIds = [...new Set([...oldMembers, ...newMembers].map((m) => m.room_id))];
      await this.occupancy.lockRooms(tx, lockIds);

      // nhả occupancy cũ TRƯỚC → pre-check phòng mới không tự đụng chính booking này
      await this.occupancy.deleteForBooking(tx, id);
      const conflicts = await this.occupancy.findOverlaps(
        tx,
        newMembers.map((m) => m.room_id),
        booking.check_in,
        booking.check_out,
      );
      if (conflicts.length > 0) {
        throw new AppException({
          code: 'BOOKING_OVERLAP',
          title: 'Phòng mới đã có khách đặt/chặn trong khoảng này',
          status: 409,
          detail: `${conflicts.length} khoảng chồng lấn`,
        });
      }
      // EXCLUDE là chốt chặn cuối (23P01 → 409 nếu race vượt pre-check)
      await this.occupancy.insertForBooking(tx, {
        tenantId: user.tnt,
        bookingId: id,
        members: newMembers,
        checkIn: booking.check_in,
        checkOut: booking.check_out,
      });
      await tx.bookings.update({
        where: { id },
        data: { resource_id: newResource.id, version: { increment: 1 } },
      });
      // status không đổi — ghi dấu vết đổi phòng vào history (audit_logs nối ở 4.5)
      await tx.booking_status_history.create({
        data: {
          tenant_id: user.tnt,
          booking_id: id,
          from_status: booking.status,
          to_status: booking.status,
          changed_by: user.sub,
          reason: `Đổi resource ${booking.resource_id} → ${newResource.id}: ${dto.reason}`,
        },
      });
      // TODO(task 4.1): tạo cleaning task cho phòng cũ (oldMembers)
      return tx.bookings.findFirstOrThrow({ where: { id } });
    });
    return toBookingResponse(updated);
  }

  /**
   * ★ Cron HOLD expiry (docs/06 §4) — gọi mỗi phút từ hold-expiry.cron.ts.
   * Lặp per-tenant qua `withTenant` (RLS set per-job — ADR-0002 §5; KHÔNG dùng
   * connection BYPASSRLS). Bảng `tenants` không có RLS nên query trần hợp lệ —
   * đây đúng là job cross-tenant của platform mà ADR-0002 §5 dự liệu.
   * Trả tổng số HOLD đã huỷ trong lượt.
   */
  async sweepExpiredHolds(): Promise<number> {
    // Liệt kê tenant cho job cross-tenant của platform: `tenants` KHÔNG có RLS nên
    // không bọc withTenant được (không có 1 tenantId để set GUC). Đây đúng là ngoại
    // lệ ADR-0002 §5 — guard rule chỉ nhắm bảng tenant-scoped trong modules/.
    // eslint-disable-next-line no-restricted-syntax -- platform cross-tenant, bảng non-RLS (ADR-0002 §5)
    const tenants = await this.prisma.tenants.findMany({
      where: { status: { in: ['TRIAL', 'ACTIVE'] } },
      select: { id: true },
    });
    let total = 0;
    for (const t of tenants) {
      total += await this.expireHoldsForTenant(t.id);
    }
    return total;
  }

  /** Huỷ mọi HOLD quá hạn của 1 tenant + xoá occupancy CÙNG tx (docs/06 §4). */
  private async expireHoldsForTenant(tenantId: string): Promise<number> {
    return withTenant(this.prisma, tenantId, async (tx) => {
      const expired = await tx.bookings.findMany({
        where: { status: 'HOLD', expires_at: { lt: new Date() } },
        select: { id: true },
        take: HOLD_SWEEP_BATCH,
      });
      for (const b of expired) {
        await tx.bookings.update({
          where: { id: b.id },
          data: {
            status: 'CANCELLED',
            cancellation_reason: 'HOLD_EXPIRED',
            cancelled_at: new Date(),
            version: { increment: 1 },
          },
        });
        await this.occupancy.deleteForBooking(tx, b.id);
        await tx.booking_status_history.create({
          data: {
            tenant_id: tenantId,
            booking_id: b.id,
            from_status: 'HOLD',
            to_status: 'CANCELLED',
            changed_by: null, // hệ thống (cron)
            reason: 'HOLD_EXPIRED',
          },
        });
      }
      return expired.length;
    });
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
