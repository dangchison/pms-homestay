import { Injectable } from '@nestjs/common';
import { roundVnd } from '@pms/pricing-engine';
import {
  type JwtClaims,
  type OffsetPageInfo,
  type PaymentResponse,
  type ShiftDetailResponse,
  type ShiftResponse,
  type ShiftStatus,
  type ShiftVarianceEventPayload,
} from '@pms/shared-types';
import { Prisma, type cash_shifts, type payments } from '@prisma/client';
import { PermissionService } from '@core/auth/permission.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { OutboxService } from '@core/outbox/outbox.service';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { parseIfMatch } from '@/shared/if-match';
import { offsetToSkipTake } from '@/shared/dto';

type Tx = Prisma.TransactionClient;

/** Payment thu tiền mặt "vào két" trong ca — dù đã bị hoàn 1 phần/toàn phần (net = amount − refunded). */
const CASH_RECEIPT_STATUS: ReadonlyArray<payments['status']> = [
  'SUCCEEDED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
];

function toShiftResponse(s: cash_shifts): ShiftResponse {
  return {
    id: s.id,
    property_id: s.property_id,
    opened_by: s.opened_by,
    opened_at: s.opened_at.toISOString(),
    opening_float_vnd: Number(s.opening_float_vnd),
    closed_by: s.closed_by,
    closed_at: s.closed_at ? s.closed_at.toISOString() : null,
    closing_counted_vnd: s.closing_counted_vnd === null ? null : Number(s.closing_counted_vnd),
    expected_cash_vnd: s.expected_cash_vnd === null ? null : Number(s.expected_cash_vnd),
    variance_vnd: s.variance_vnd === null ? null : Number(s.variance_vnd),
    status: s.status as ShiftStatus,
    note: s.note,
    version: s.version,
    created_at: s.created_at.toISOString(),
    updated_at: s.updated_at.toISOString(),
  };
}

function toPaymentResponse(p: payments): PaymentResponse {
  return {
    id: p.id,
    invoice_id: p.invoice_id,
    amount_vnd: Number(p.amount_vnd),
    method: p.method as PaymentResponse['method'],
    status: p.status,
    reference_code: p.reference_code,
    refunded_amount_vnd: Number(p.refunded_amount_vnd),
    received_at: p.received_at ? p.received_at.toISOString() : null,
    created_at: p.created_at.toISOString(),
  };
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/**
 * ★ ShiftsService — Sổ quỹ ca (task 9.4, docs/16 #10, Wave 1 chống thất thoát tiền mặt).
 *
 * Mở/đóng ca của MỘT cơ sở. Tiền mặt kỳ vọng cuối ca:
 *   expected = float + Σ(payment CASH SUCCEEDED, received_at ∈ [opened_at, now], tại cơ sở)
 *              − Σ(refunded_amount_vnd của chính các payment CASH đó)
 * Cửa sổ dùng received_at (đặt = now() lúc ghi payment) → payment trước khi mở ca
 * KHÔNG được tính. Chỉ 1 ca OPEN / cơ sở (partial unique) nên các cửa sổ không chồng.
 * Refund tính theo refunded_amount_vnd HIỆN TẠI của payment lúc đóng ca (không theo
 * ngày refund) — chấp nhận cho MVP đối quỹ ca. Chỉ CASH (VIETQR/BANK_TRANSFER không
 * nằm trong két). variance_vnd là GENERATED STORED (counted − expected) → đọc lại sau
 * update; service KHÔNG ghi tay. Chênh lệch != 0 → emit shift.variance_detected (outbox).
 */
@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * POST /shifts — mở ca. Idempotency-Key: replay trả đúng ca cũ (khớp opened_by +
   * property + key qua note-less lookup không đủ — ta dựa vào ca OPEN hiện có +
   * partial-unique làm hàng rào). Ở đây key chỉ để replay an toàn khi client retry.
   */
  async open(
    dto: { property_id: string; opening_float_vnd: number; note?: string },
    idempotencyKey: string | undefined,
    user: JwtClaims,
  ): Promise<ShiftResponse> {
    await this.permissionService.authorizeOnProperty(user, dto.property_id, 'payment.reconcile');

    // Replay/guard chủ động: đã có ca OPEN ở cơ sở → trả về ca đó nếu replay đúng key,
    // ngược lại 409. (Idempotency-Key không bắt buộc — hàng rào chính là partial-unique.)
    const openShift = await this.findOpenShift(user.tnt, dto.property_id);
    if (openShift) {
      if (idempotencyKey && openShift.idempotency_key === idempotencyKey) {
        return toShiftResponse(openShift);
      }
      throw this.shiftAlreadyOpen();
    }

    try {
      const created = await withTenant(this.prisma, user.tnt, (tx) =>
        tx.cash_shifts.create({
          data: {
            tenant_id: user.tnt,
            property_id: dto.property_id,
            opened_by: user.sub,
            opening_float_vnd: dto.opening_float_vnd,
            status: 'OPEN',
            note: dto.note,
            idempotency_key: idempotencyKey,
          } satisfies Prisma.cash_shiftsUncheckedCreateInput,
        }),
      );
      return toShiftResponse(created);
    } catch (e) {
      // Race: 2 request cùng lúc → 1 thắng partial-unique, 1 dính P2002.
      if (isUniqueViolation(e)) {
        const existing = await this.findOpenShift(user.tnt, dto.property_id);
        if (existing && idempotencyKey && existing.idempotency_key === idempotencyKey) {
          return toShiftResponse(existing); // replay của chính request thua race
        }
        throw this.shiftAlreadyOpen();
      }
      throw e;
    }
  }

  /** GET /shifts — danh sách + lọc property/status/from/to, phân trang offset. Chỉ đọc. */
  async list(
    query: {
      property_id?: string;
      status?: ShiftStatus;
      from?: string;
      to?: string;
      page: number;
      page_size: number;
    },
    user: JwtClaims,
  ): Promise<{ data: ShiftResponse[]; page_info: OffsetPageInfo }> {
    const { skip, take } = offsetToSkipTake(query);
    const where: Prisma.cash_shiftsWhereInput = {
      ...(query.property_id ? { property_id: query.property_id } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            opened_at: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };

    const { rows, total } = await withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const [rows, total] = await Promise.all([
          tx.cash_shifts.findMany({ where, orderBy: { opened_at: 'desc' }, skip, take }),
          tx.cash_shifts.count({ where }),
        ]);
        return { rows, total };
      },
      { readOnly: true },
    );

    return {
      data: rows.map(toShiftResponse),
      page_info: {
        page: query.page,
        page_size: query.page_size,
        total_items: total,
        total_pages: Math.max(1, Math.ceil(total / query.page_size)),
      },
    };
  }

  /**
   * GET /shifts/:id — chi tiết ca + danh sách payment CASH thuộc ca (SUCCEEDED,
   * received_at ∈ [opened_at, closed_at ?? now], tại cơ sở của ca). Cross-tenant → 404.
   */
  async getDetail(id: string, user: JwtClaims): Promise<ShiftDetailResponse> {
    const shift = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, shift.property_id, 'report.financial');

    const windowEnd = shift.closed_at ?? new Date();
    const payments = await withTenant(
      this.prisma,
      user.tnt,
      (tx) =>
        tx.payments.findMany({
          where: this.cashInWindowWhere(shift.property_id, shift.opened_at, windowEnd),
          orderBy: { received_at: 'asc' },
        }),
      { readOnly: true },
    );

    return { ...toShiftResponse(shift), cash_payments: payments.map(toPaymentResponse) };
  }

  /**
   * POST /shifts/:id/close — đóng ca (chỉ ca OPEN). If-Match = version (optimistic).
   * Tính expected TRONG cùng tx (unit-of-work), ghi counted/expected/closed_*; đọc
   * lại row để lấy variance (generated). Chênh lệch != 0 → emit shift.variance_detected.
   */
  async close(
    id: string,
    ifMatch: string | undefined,
    dto: { closing_counted_vnd: number; note?: string },
    user: JwtClaims,
  ): Promise<ShiftResponse> {
    const expectedVersion = parseIfMatch(ifMatch);
    const shift = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, shift.property_id, 'payment.reconcile');
    if (shift.status !== 'OPEN') throw this.shiftNotOpen(shift.status);

    const closed = await withTenant(this.prisma, user.tnt, async (tx) => {
      const now = new Date();
      const expected = await this.computeExpectedCashInTx(tx, shift, now);

      // Optimistic lock + chỉ đóng ca OPEN — cả hai trong 1 updateMany (race-safe).
      const result = await tx.cash_shifts.updateMany({
        where: { id, version: expectedVersion, status: 'OPEN' },
        data: {
          status: 'CLOSED',
          closed_by: user.sub,
          closed_at: now,
          closing_counted_vnd: dto.closing_counted_vnd,
          expected_cash_vnd: expected,
          ...(dto.note !== undefined ? { note: dto.note } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count === 0) {
        // Phân biệt: đã bị đóng bởi người khác (status đổi) vs lệch version.
        const fresh = await tx.cash_shifts.findFirst({ where: { id }, select: { status: true } });
        if (fresh && fresh.status !== 'OPEN') throw this.shiftNotOpen(fresh.status);
        throw this.versionConflict();
      }

      // variance_vnd là GENERATED STORED → đọc lại row sau update để lấy giá trị đã tính.
      const fresh = await tx.cash_shifts.findFirstOrThrow({ where: { id } });
      const variance = fresh.variance_vnd === null ? 0 : Number(fresh.variance_vnd);
      if (variance !== 0) {
        const payload: ShiftVarianceEventPayload = {
          shift_id: fresh.id,
          property_id: fresh.property_id,
          variance_vnd: variance,
        };
        await this.outbox.publish(tx, {
          event_type: 'shift.variance_detected',
          aggregate_type: 'cash_shift',
          aggregate_id: fresh.id,
          payload,
        });
      }
      return fresh;
    });
    return toShiftResponse(closed);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * expected = float + Σ(amount) − Σ(refunded) của payment CASH thu trong ca. Một
   * aggregate lấy cả hai tổng. roundVnd bọc kết quả (money — docs/01 §4).
   */
  private async computeExpectedCashInTx(tx: Tx, shift: cash_shifts, windowEnd: Date): Promise<number> {
    const agg = await tx.payments.aggregate({
      where: this.cashInWindowWhere(shift.property_id, shift.opened_at, windowEnd),
      _sum: { amount_vnd: true, refunded_amount_vnd: true },
    });
    const received = Number(agg._sum.amount_vnd ?? 0);
    const refunded = Number(agg._sum.refunded_amount_vnd ?? 0);
    return roundVnd(Number(shift.opening_float_vnd) + received - refunded);
  }

  /** WHERE payment CASH thu tiền vào két trong [from, to] tại cơ sở (qua invoice→booking). */
  private cashInWindowWhere(propertyId: string, from: Date, to: Date): Prisma.paymentsWhereInput {
    return {
      method: 'CASH',
      status: { in: [...CASH_RECEIPT_STATUS] },
      received_at: { gte: from, lte: to },
      invoices: { bookings: { property_id: propertyId } },
    };
  }

  private async findOpenShift(
    tenantId: string,
    propertyId: string,
  ): Promise<cash_shifts | null> {
    return withTenant(
      this.prisma,
      tenantId,
      (tx) => tx.cash_shifts.findFirst({ where: { property_id: propertyId, status: 'OPEN' } }),
      { readOnly: true },
    );
  }

  private async loadOrThrow(id: string, user: JwtClaims): Promise<cash_shifts> {
    const shift = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.cash_shifts.findFirst({ where: { id } }),
      { readOnly: true },
    );
    if (!shift) {
      throw new AppException({ code: 'SHIFT_NOT_FOUND', title: 'Ca không tồn tại', status: 404 });
    }
    return shift;
  }

  private shiftAlreadyOpen(): AppException {
    return new AppException({
      code: 'SHIFT_ALREADY_OPEN',
      title: 'Cơ sở đang có ca mở — đóng ca hiện tại trước khi mở ca mới',
      status: 409,
    });
  }

  private shiftNotOpen(status: string): AppException {
    return new AppException({
      code: 'SHIFT_NOT_OPEN',
      title: `Ca đang ${status} — chỉ đóng được ca đang OPEN`,
      status: 422,
    });
  }

  private versionConflict(): AppException {
    return new AppException({
      code: 'VERSION_CONFLICT',
      title: 'Ca đã bị sửa bởi người khác — tải lại rồi thử lại',
      status: 409,
    });
  }
}
