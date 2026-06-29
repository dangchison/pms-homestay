import { Injectable } from '@nestjs/common';
import { computeDeposit, roundVnd } from '@pms/pricing-engine';
import {
  type CreateInvoiceRequest,
  type InvoiceEventPayload,
  type InvoiceResponse,
  type JwtClaims,
  type OffsetPageInfo,
  type QuoteLineItem,
  type VoidInvoiceRequest,
} from '@pms/shared-types';
import { type DepositType } from '@pms/pricing-engine';
import { Prisma, type invoice_items, type invoices } from '@prisma/client';
import { PermissionService } from '@core/auth/permission.service';
import { DocumentCounterService, periodOf } from '@core/counters/document-counter.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { OutboxService } from '@core/outbox/outbox.service';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { assertInvoiceTransition } from './invoice-status-machine';

type Tx = Prisma.TransactionClient;

/** Snapshot tối thiểu của booking mà luồng invoice cần (truyền từ BookingsService). */
export interface BookingForInvoice {
  id: string;
  tenant_id: string;
  booking_code: string;
  rate_plan_id: string | null;
  quote_id: string | null;
  total_amount_vnd: bigint;
}

function toInvoiceResponse(inv: invoices, items: invoice_items[]): InvoiceResponse {
  return {
    id: inv.id,
    booking_id: inv.booking_id,
    kind: inv.kind,
    invoice_number: inv.invoice_number,
    status: inv.status,
    billing_period: inv.billing_period,
    subtotal_vnd: Number(inv.subtotal_vnd),
    discount_vnd: Number(inv.discount_vnd),
    tax_vnd: Number(inv.tax_vnd),
    total_vnd: Number(inv.total_vnd),
    paid_vnd: Number(inv.paid_vnd),
    balance_vnd: Number(inv.balance_vnd ?? inv.total_vnd - inv.paid_vnd),
    due_date: inv.due_date ? inv.due_date.toISOString().slice(0, 10) : null,
    issued_at: inv.issued_at ? inv.issued_at.toISOString() : null,
    paid_at: inv.paid_at ? inv.paid_at.toISOString() : null,
    void_reason: inv.void_reason,
    version: inv.version,
    created_at: inv.created_at.toISOString(),
    updated_at: inv.updated_at.toISOString(),
    items: items
      .sort((a, b) => a.display_order - b.display_order)
      .map((it) => ({
        id: it.id,
        item_type: it.item_type as InvoiceResponse['items'][number]['item_type'],
        description: it.description,
        quantity: Number(it.quantity),
        unit_price_vnd: Number(it.unit_price_vnd),
        amount_vnd: Number(it.amount_vnd),
        ref_invoice_id: it.ref_invoice_id,
        display_order: it.display_order,
      })),
  };
}

/**
 * ★ InvoicesService (docs/09 §4, ADR-0003) — sở hữu invoices/invoice_items.
 * KHÔNG phụ thuộc BookingsService (một chiều): luồng deposit→confirm do
 * BookingsService điều phối, gọi markDepositPaid trong cùng tx. paid_vnd ở 3.2
 * do markDepositPaid set tạm (seam); task 3.3 thay bằng trigger từ payments.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly counters: DocumentCounterService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Emit invoice.issued qua outbox CÙNG tx (task 4.3). Chỉ cho hành động phát hành
   * TƯỜNG MINH (ad-hoc/issue endpoint); DEPOSIT/STAY auto-issue trong luồng booking
   * đã được booking.created/checked_out cover (tránh emit trùng). property_id null
   * (ad-hoc không gắn booking) → chỉ OWNER thấy qua SSE.
   */
  private emitInvoiceIssued(
    tx: Tx,
    invoiceId: string,
    propertyId: string | null,
    bookingId: string | null,
  ): Promise<void> {
    const payload: InvoiceEventPayload = { invoice_id: invoiceId };
    if (propertyId) payload.property_id = propertyId;
    if (bookingId) payload.booking_id = bookingId;
    return this.outbox.publish(tx, {
      event_type: 'invoice.issued',
      aggregate_type: 'invoice',
      aggregate_id: invoiceId,
      payload,
    });
  }

  // ── Nội bộ: gọi TRONG tx có sẵn của BookingsService (không tự mở withTenant) ──

  /**
   * Issue DEPOSIT invoice tại PENDING (docs/09 §4.2). Cọc theo deposit_type/value
   * của rate plan áp lên total booking; NONE/0 → null (skip). Idempotent: đã có
   * DEPOSIT non-VOID → trả lại cái cũ. Tạo DRAFT → 1 item ROOM_CHARGE → ISSUED.
   */
  async issueDepositForBooking(
    tx: Tx,
    booking: BookingForInvoice,
  ): Promise<{ id: string; total_vnd: number } | null> {
    if (!booking.rate_plan_id) return null;
    const plan = await tx.rate_plans.findFirst({
      where: { id: booking.rate_plan_id },
      select: { deposit_type: true, deposit_value: true },
    });
    if (!plan) return null;
    const depositVnd = computeDeposit(
      Number(booking.total_amount_vnd),
      plan.deposit_type as DepositType,
      Number(plan.deposit_value),
    );
    if (depositVnd <= 0) return null;

    const existing = await tx.invoices.findFirst({
      where: { booking_id: booking.id, kind: 'DEPOSIT', status: { not: 'VOID' } },
      select: { id: true, total_vnd: true },
    });
    if (existing) return { id: existing.id, total_vnd: Number(existing.total_vnd) };

    const number = await this.counters.nextCode(tx, booking.tenant_id, 'INV', periodOf(new Date()));
    const inv = await tx.invoices.create({
      data: {
        tenant_id: booking.tenant_id,
        booking_id: booking.id,
        kind: 'DEPOSIT',
        invoice_number: number,
        status: 'DRAFT',
      },
      select: { id: true },
    });
    await tx.invoice_items.create({
      data: {
        tenant_id: booking.tenant_id,
        invoice_id: inv.id,
        item_type: 'ROOM_CHARGE',
        description: `Đặt cọc booking ${booking.booking_code}`,
        quantity: 1,
        unit_price_vnd: depositVnd,
        amount_vnd: depositVnd,
      },
    });
    await tx.invoices.update({
      where: { id: inv.id },
      data: { status: 'ISSUED', issued_at: new Date(), version: { increment: 1 } },
    });
    return { id: inv.id, total_vnd: depositVnd };
  }

  /**
   * Issue STAY invoice lúc check-out (docs/09 §4.3): items copy từ quote snapshot
   * + DEPOSIT_APPLIED âm (cấn cọc đã thu, ref → DEPOSIT invoice). Idempotent.
   */
  async issueStayForBooking(tx: Tx, booking: BookingForInvoice): Promise<void> {
    const existing = await tx.invoices.findFirst({
      where: { booking_id: booking.id, kind: 'STAY', status: { not: 'VOID' } },
      select: { id: true },
    });
    if (existing) return;

    const number = await this.counters.nextCode(tx, booking.tenant_id, 'INV', periodOf(new Date()));
    const inv = await tx.invoices.create({
      data: {
        tenant_id: booking.tenant_id,
        booking_id: booking.id,
        kind: 'STAY',
        invoice_number: number,
        status: 'DRAFT',
      },
      select: { id: true },
    });

    let order = 0;
    const lineItems = booking.quote_id
      ? (((await tx.quotes.findFirst({
          where: { id: booking.quote_id },
          select: { line_items: true },
        }))?.line_items ?? []) as unknown as QuoteLineItem[])
      : [];
    for (const li of lineItems) {
      await tx.invoice_items.create({
        data: {
          tenant_id: booking.tenant_id,
          invoice_id: inv.id,
          item_type: li.type,
          description: li.description,
          quantity: li.quantity,
          unit_price_vnd: li.unit_price_vnd,
          amount_vnd: li.amount_vnd,
          display_order: order++,
        },
      });
    }
    // Phòng vệ: thiếu quote snapshot → 1 dòng ROOM_CHARGE = giá đã chốt
    if (lineItems.length === 0) {
      await tx.invoice_items.create({
        data: {
          tenant_id: booking.tenant_id,
          invoice_id: inv.id,
          item_type: 'ROOM_CHARGE',
          description: `Tiền phòng booking ${booking.booking_code}`,
          quantity: 1,
          unit_price_vnd: booking.total_amount_vnd,
          amount_vnd: booking.total_amount_vnd,
          display_order: order++,
        },
      });
    }

    // Cấn cọc đã thu (theo paid_vnd của DEPOSIT invoice — phần thực thu)
    const deposit = await tx.invoices.findFirst({
      where: { booking_id: booking.id, kind: 'DEPOSIT', status: { not: 'VOID' } },
      select: { id: true, paid_vnd: true },
    });
    const appliedVnd = deposit ? Number(deposit.paid_vnd) : 0;
    if (deposit && appliedVnd > 0) {
      await tx.invoice_items.create({
        data: {
          tenant_id: booking.tenant_id,
          invoice_id: inv.id,
          item_type: 'DEPOSIT_APPLIED',
          description: 'Cấn trừ tiền cọc đã thu',
          quantity: 1,
          unit_price_vnd: -appliedVnd,
          amount_vnd: -appliedVnd,
          ref_invoice_id: deposit.id,
          display_order: order++,
        },
      });
    }
    await tx.invoices.update({
      where: { id: inv.id },
      data: { status: 'ISSUED', issued_at: new Date(), version: { increment: 1 } },
    });
  }

  /**
   * ★ Forfeit cọc khi NO_SHOW (docs/09 §4 — "DEPOSIT giữ PAID, ghi nhận doanh thu
   * hủy qua ADJUSTMENT note"). Gọi TRONG tx night-audit lúc booking → NO_SHOW.
   * Nếu DEPOSIT invoice đã thu (paid_vnd > 0): sinh ADJUSTMENT ISSUED 2 dòng —
   * SURCHARGE (+phần đã thu = doanh thu tịch thu) + DEPOSIT_APPLIED (−phần đó, ref →
   * DEPOSIT) → total/balance = 0 (cọc giữ lại là tiền thực thu, KHÔNG thu thêm).
   * DEPOSIT invoice GIỮ NGUYÊN PAID. Idempotent: đã có dòng cấn cọc này → bỏ qua
   * (NO_SHOW không có STAY nên DEPOSIT_APPLIED ref cọc chỉ đến từ forfeit trước).
   * Trả số tiền forfeit (0 = không có cọc đã thu → không sinh gì).
   */
  async forfeitDepositForBooking(
    tx: Tx,
    booking: { id: string; tenant_id: string; booking_code: string },
  ): Promise<number> {
    const deposit = await tx.invoices.findFirst({
      where: { booking_id: booking.id, kind: 'DEPOSIT', status: { not: 'VOID' } },
      select: { id: true, paid_vnd: true },
    });
    const forfeitedVnd = deposit ? Number(deposit.paid_vnd) : 0;
    if (!deposit || forfeitedVnd <= 0) return 0;

    const already = await tx.invoice_items.findFirst({
      where: { tenant_id: booking.tenant_id, ref_invoice_id: deposit.id, item_type: 'DEPOSIT_APPLIED' },
      select: { id: true },
    });
    if (already) return 0;

    const number = await this.counters.nextCode(tx, booking.tenant_id, 'INV', periodOf(new Date()));
    const inv = await tx.invoices.create({
      data: {
        tenant_id: booking.tenant_id,
        booking_id: booking.id,
        kind: 'ADJUSTMENT',
        invoice_number: number,
        status: 'DRAFT',
      },
      select: { id: true },
    });
    await tx.invoice_items.create({
      data: {
        tenant_id: booking.tenant_id,
        invoice_id: inv.id,
        item_type: 'SURCHARGE',
        description: `Phí no-show — tịch thu cọc booking ${booking.booking_code}`,
        quantity: 1,
        unit_price_vnd: forfeitedVnd,
        amount_vnd: forfeitedVnd,
        display_order: 0,
      },
    });
    await tx.invoice_items.create({
      data: {
        tenant_id: booking.tenant_id,
        invoice_id: inv.id,
        item_type: 'DEPOSIT_APPLIED',
        description: 'Cấn cọc đã thu (giữ lại do no-show)',
        quantity: 1,
        unit_price_vnd: -forfeitedVnd,
        amount_vnd: -forfeitedVnd,
        ref_invoice_id: deposit.id,
        display_order: 1,
      },
    });
    await tx.invoices.update({
      where: { id: inv.id },
      data: { status: 'ISSUED', issued_at: new Date(), version: { increment: 1 } },
    });
    return forfeitedVnd;
  }

  // ── Public REST ─────────────────────────────────────────────────────────

  /** POST /invoices — ad-hoc/ADJUSTMENT (docs/09 §4.4). issue=true → phát hành ngay. */
  async createAdHoc(dto: CreateInvoiceRequest, user: JwtClaims): Promise<InvoiceResponse> {
    let bookingId: string | null = null;
    let propertyId: string | null = null;
    if (dto.booking_id) {
      const booking = await this.loadBooking(dto.booking_id, user);
      await this.permissionService.authorizeOnProperty(user, booking.property_id, 'invoice.create_adhoc');
      bookingId = booking.id;
      propertyId = booking.property_id;
    }
    const created = await withTenant(this.prisma, user.tnt, async (tx) => {
      const number = await this.counters.nextCode(tx, user.tnt, 'INV', periodOf(new Date()));
      const inv = await tx.invoices.create({
        data: {
          tenant_id: user.tnt,
          booking_id: bookingId,
          kind: dto.kind,
          invoice_number: number,
          status: 'DRAFT',
          due_date: dto.due_date ? new Date(dto.due_date) : null,
        },
        select: { id: true },
      });
      let order = 0;
      for (const item of dto.items) {
        const amount = roundVnd(item.quantity * item.unit_price_vnd);
        await tx.invoice_items.create({
          data: {
            tenant_id: user.tnt,
            invoice_id: inv.id,
            item_type: item.item_type,
            description: item.description,
            quantity: item.quantity,
            unit_price_vnd: item.unit_price_vnd,
            amount_vnd: amount,
            display_order: order++,
          },
        });
      }
      if (dto.issue) {
        await tx.invoices.update({
          where: { id: inv.id },
          data: { status: 'ISSUED', issued_at: new Date(), version: { increment: 1 } },
        });
        await this.emitInvoiceIssued(tx, inv.id, propertyId, bookingId);
      }
      return this.loadFull(tx, inv.id);
    });
    return toInvoiceResponse(created.invoice, created.items);
  }

  /** POST /invoices/:id/issue — DRAFT → ISSUED. */
  async issue(id: string, user: JwtClaims): Promise<InvoiceResponse> {
    return this.transition(id, user, 'invoice.create_adhoc', 'ISSUED', (data) => {
      data.issued_at = new Date();
    });
  }

  /** POST /invoices/:id/void — giữ số (docs/09 §2.4), ghi lý do. */
  async void(id: string, dto: VoidInvoiceRequest, user: JwtClaims): Promise<InvoiceResponse> {
    return this.transition(id, user, 'invoice.void', 'VOID', (data) => {
      data.void_reason = dto.reason;
      data.voided_at = new Date();
      data.voided_by = user.sub;
    });
  }

  async getById(id: string, user: JwtClaims): Promise<InvoiceResponse> {
    const { invoice, items, propertyId } = await this.loadWithProperty(id, user);
    if (propertyId) await this.permissionService.authorizeOnProperty(user, propertyId, 'invoice.read');
    return toInvoiceResponse(invoice, items);
  }

  /** GET /invoices?booking_id= — danh sách hoá đơn của 1 booking. */
  async listByBooking(bookingId: string, user: JwtClaims): Promise<InvoiceResponse[]> {
    const booking = await this.loadBooking(bookingId, user);
    await this.permissionService.authorizeOnProperty(user, booking.property_id, 'invoice.read');
    const rows = await withTenant(
      this.prisma,
      user.tnt,
      (tx) =>
        tx.invoices.findMany({
          where: { booking_id: bookingId },
          orderBy: { created_at: 'asc' },
          include: { invoice_items: true },
        }),
      { readOnly: true },
    );
    return rows.map((r) => toInvoiceResponse(r, r.invoice_items));
  }

  /** Danh sách hoá đơn theo cơ sở + filter (F1, task 6.4). JOIN bookings để lấy property
   *  (hoá đơn ad-hoc booking_id null KHÔNG vào list theo property). */
  async listByProperty(
    query: {
      property_id?: string;
      status?: InvoiceResponse['status'];
      kind?: InvoiceResponse['kind'];
      from?: string;
      to?: string;
      page: number;
      page_size: number;
    },
    user: JwtClaims,
  ): Promise<{ data: InvoiceResponse[]; page_info: OffsetPageInfo }> {
    const propertyId = query.property_id;
    if (!propertyId) {
      throw new AppException({ code: 'VALIDATION', title: 'Cần property_id', status: 400 });
    }
    await this.permissionService.authorizeOnProperty(user, propertyId, 'invoice.read');
    const where: Prisma.invoicesWhereInput = {
      bookings: { property_id: propertyId },
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.from || query.to
        ? {
            created_at: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };
    const { page, page_size } = query;
    return withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const [rows, total] = await Promise.all([
          tx.invoices.findMany({
            where,
            orderBy: { created_at: 'desc' },
            include: { invoice_items: true },
            skip: (page - 1) * page_size,
            take: page_size,
          }),
          tx.invoices.count({ where }),
        ]);
        return {
          data: rows.map((r) => toInvoiceResponse(r, r.invoice_items)),
          page_info: {
            page,
            page_size,
            total_items: total,
            total_pages: Math.max(1, Math.ceil(total / page_size)),
          },
        };
      },
      { readOnly: true },
    );
  }

  /** Bối cảnh invoice để PaymentsService (3.3) phân quyền + validate trước khi ghi payment. */
  async loadForPayment(
    invoiceId: string,
    user: JwtClaims,
  ): Promise<{
    id: string;
    status: invoices['status'];
    kind: invoices['kind'];
    booking_id: string | null;
    property_id: string | null;
  }> {
    const inv = await withTenant(
      this.prisma,
      user.tnt,
      (tx) =>
        tx.invoices.findFirst({
          where: { id: invoiceId },
          select: {
            id: true,
            status: true,
            kind: true,
            booking_id: true,
            bookings: { select: { property_id: true } },
          },
        }),
      { readOnly: true },
    );
    if (!inv) {
      throw new AppException({ code: 'INVOICE_NOT_FOUND', title: 'Hoá đơn không tồn tại', status: 404 });
    }
    return {
      id: inv.id,
      status: inv.status,
      kind: inv.kind,
      booking_id: inv.booking_id,
      property_id: inv.bookings?.property_id ?? null,
    };
  }

  /** Input dựng VietQR động (docs/12 §5): số dư còn nợ + addInfo + TK nhận của cơ sở. */
  async getQrTarget(
    invoiceId: string,
    user: JwtClaims,
  ): Promise<{ amount: number; addInfo: string; bankBin: string; accountNumber: string; accountName: string | null }> {
    const data = await withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const inv = await tx.invoices.findFirst({
          where: { id: invoiceId },
          select: {
            invoice_number: true,
            total_vnd: true,
            paid_vnd: true,
            bookings: { select: { booking_code: true, property_id: true } },
          },
        });
        if (!inv) return null;
        const prop = inv.bookings
          ? await tx.properties.findFirst({
              where: { id: inv.bookings.property_id },
              select: { bank_bin: true, bank_account_number: true, bank_account_name: true },
            })
          : null;
        return { inv, prop, propertyId: inv.bookings?.property_id ?? null };
      },
      { readOnly: true },
    );
    if (!data) {
      throw new AppException({ code: 'INVOICE_NOT_FOUND', title: 'Hoá đơn không tồn tại', status: 404 });
    }
    if (data.propertyId) await this.permissionService.authorizeOnProperty(user, data.propertyId, 'invoice.read');

    const balance = Number(data.inv.total_vnd) - Number(data.inv.paid_vnd);
    if (balance <= 0) {
      throw new AppException({ code: 'INVOICE_NO_BALANCE', title: 'Hoá đơn không còn số dư phải trả', status: 422 });
    }
    if (!data.prop?.bank_bin || !data.prop.bank_account_number) {
      throw new AppException({
        code: 'BANK_ACCOUNT_NOT_CONFIGURED',
        title: 'Cơ sở chưa cấu hình tài khoản nhận tiền (VietQR)',
        status: 422,
      });
    }
    return {
      amount: balance,
      addInfo: data.inv.bookings?.booking_code ?? data.inv.invoice_number,
      bankBin: data.prop.bank_bin,
      accountNumber: data.prop.bank_account_number,
      accountName: data.prop.bank_account_name,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async transition(
    id: string,
    user: JwtClaims,
    permission: 'invoice.create_adhoc' | 'invoice.void',
    to: 'ISSUED' | 'VOID',
    mutate: (data: Prisma.invoicesUpdateInput) => void,
  ): Promise<InvoiceResponse> {
    const { invoice, propertyId } = await this.loadWithProperty(id, user);
    if (propertyId) await this.permissionService.authorizeOnProperty(user, propertyId, permission);
    assertInvoiceTransition(invoice.status, to);
    const updated = await withTenant(this.prisma, user.tnt, async (tx) => {
      const data: Prisma.invoicesUpdateInput = { status: to, version: { increment: 1 } };
      mutate(data);
      await tx.invoices.update({ where: { id }, data });
      if (to === 'ISSUED') await this.emitInvoiceIssued(tx, id, propertyId, invoice.booking_id);
      return this.loadFull(tx, id);
    });
    return toInvoiceResponse(updated.invoice, updated.items);
  }

  private async loadFull(tx: Tx, id: string): Promise<{ invoice: invoices; items: invoice_items[] }> {
    const invoice = await tx.invoices.findFirstOrThrow({
      where: { id },
      include: { invoice_items: true },
    });
    return { invoice, items: invoice.invoice_items };
  }

  private async loadWithProperty(
    id: string,
    user: JwtClaims,
  ): Promise<{ invoice: invoices; items: invoice_items[]; propertyId: string | null }> {
    const result = await withTenant(
      this.prisma,
      user.tnt,
      (tx) =>
        tx.invoices.findFirst({
          where: { id },
          include: { invoice_items: true, bookings: { select: { property_id: true } } },
        }),
      { readOnly: true },
    );
    if (!result) {
      throw new AppException({ code: 'INVOICE_NOT_FOUND', title: 'Hoá đơn không tồn tại', status: 404 });
    }
    return { invoice: result, items: result.invoice_items, propertyId: result.bookings?.property_id ?? null };
  }

  private async loadBooking(
    bookingId: string,
    user: JwtClaims,
  ): Promise<{ id: string; property_id: string }> {
    const booking = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.bookings.findFirst({ where: { id: bookingId }, select: { id: true, property_id: true } }),
      { readOnly: true },
    );
    if (!booking) {
      throw new AppException({ code: 'BOOKING_NOT_FOUND', title: 'Booking không tồn tại', status: 404 });
    }
    return booking;
  }
}
