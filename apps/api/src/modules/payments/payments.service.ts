import { Injectable } from '@nestjs/common';
import {
  type CreatePaymentRequest,
  type JwtClaims,
  type PaymentEventPayload,
  type PaymentResponse,
  type RefundPaymentRequest,
} from '@pms/shared-types';
import { Prisma, type invoices, type payments } from '@prisma/client';

type Tx = Prisma.TransactionClient;
import { PermissionService } from '@core/auth/permission.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { OutboxService } from '@core/outbox/outbox.service';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { BookingsService } from '@modules/bookings/bookings.service';
import { InvoicesService } from '@modules/invoices/invoices.service';

/** Invoice nhận thanh toán khi đã phát hành (chưa PAID hẳn / chưa VOID). */
const PAYABLE: ReadonlyArray<invoices['status']> = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'];

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
 * ★ PaymentsService (docs/09 §5, ADR-0003). Ghi payment → trigger DB tự cập nhật
 * invoices.paid_vnd + status (PARTIALLY_PAID/PAID). DEPOSIT invoice PAID → booking
 * tự CONFIRMED (gọi BookingsService trong cùng tx). Tiền mặt/chuyển khoản =
 * SUCCEEDED ngay (MVP §5.1). Idempotency qua payments.idempotency_key (unique index).
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly invoices: InvoicesService,
    private readonly bookings: BookingsService,
    private readonly outbox: OutboxService,
  ) {}

  /** Liệt kê payment của một hoá đơn (task 6.4, F2 — để hiển thị + chọn refund). */
  async listByInvoice(invoiceId: string, user: JwtClaims): Promise<PaymentResponse[]> {
    const invoice = await this.invoices.loadForPayment(invoiceId, user);
    if (invoice.property_id) {
      await this.permissionService.authorizeOnProperty(user, invoice.property_id, 'invoice.read');
    }
    const rows = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.payments.findMany({ where: { invoice_id: invoiceId }, orderBy: { created_at: 'desc' } }),
      { readOnly: true },
    );
    return rows.map(toPaymentResponse);
  }

  async record(
    dto: CreatePaymentRequest,
    idempotencyKey: string | undefined,
    user: JwtClaims,
  ): Promise<PaymentResponse> {
    // Idempotency TRƯỚC mọi check: replay phải trả kết quả cũ kể cả khi invoice
    // nay đã PAID (lần ghi đầu đã đẩy nó PAID) — nếu không sẽ vướng payable-check.
    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(user.tnt, idempotencyKey);
      if (existing) return toPaymentResponse(existing);
    }

    const invoice = await this.invoices.loadForPayment(dto.invoice_id, user);
    if (invoice.property_id) {
      await this.permissionService.authorizeOnProperty(user, invoice.property_id, 'payment.record');
    }
    if (!PAYABLE.includes(invoice.status)) {
      throw new AppException({
        code: 'INVOICE_NOT_PAYABLE',
        title: `Hoá đơn ${invoice.status} không nhận thanh toán`,
        status: 422,
      });
    }

    try {
      const payment = await withTenant(this.prisma, user.tnt, (tx) =>
        this.applyPaymentInTx(tx, {
          tenantId: user.tnt,
          invoiceId: dto.invoice_id,
          amountVnd: dto.amount_vnd,
          method: dto.method,
          referenceCode: dto.reference_code,
          receivedBy: user.sub,
          idempotencyKey,
        }),
      );
      return toPaymentResponse(payment);
    } catch (e) {
      if (isUniqueViolation(e) && idempotencyKey) {
        const existing = await this.findByIdempotencyKey(user.tnt, idempotencyKey);
        if (existing) return toPaymentResponse(existing); // race replay
      }
      throw e;
    }
  }

  /** Hoàn tiền (docs/09 §5 refund). Bỏ trống amount = hoàn phần còn lại; trigger tính lại paid_vnd. */
  async refund(
    paymentId: string,
    dto: RefundPaymentRequest,
    user: JwtClaims,
  ): Promise<PaymentResponse> {
    const propertyId = await this.loadPaymentProperty(paymentId, user);
    if (propertyId) await this.permissionService.authorizeOnProperty(user, propertyId, 'payment.refund');

    const updated = await withTenant(this.prisma, user.tnt, async (tx) => {
      const p = await tx.payments.findFirst({ where: { id: paymentId } });
      if (!p) {
        throw new AppException({ code: 'PAYMENT_NOT_FOUND', title: 'Payment không tồn tại', status: 404 });
      }
      if (p.status !== 'SUCCEEDED' && p.status !== 'PARTIALLY_REFUNDED') {
        throw new AppException({
          code: 'PAYMENT_NOT_REFUNDABLE',
          title: `Payment ${p.status} không thể hoàn`,
          status: 422,
        });
      }
      const remaining = Number(p.amount_vnd) - Number(p.refunded_amount_vnd);
      const refundAmt = dto.amount_vnd ?? remaining;
      if (refundAmt <= 0 || refundAmt > remaining) {
        throw new AppException({
          code: 'REFUND_AMOUNT_INVALID',
          title: `Số tiền hoàn không hợp lệ (còn có thể hoàn ${remaining}đ)`,
          status: 422,
        });
      }
      const newRefunded = Number(p.refunded_amount_vnd) + refundAmt;
      const status = newRefunded >= Number(p.amount_vnd) ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      await tx.payments.update({
        where: { id: paymentId },
        data: {
          refunded_amount_vnd: newRefunded,
          status,
          refunded_at: new Date(),
          refund_reason: dto.reason,
        },
      });
      await tx.payment_attempts.create({
        data: { tenant_id: user.tnt, payment_id: paymentId, attempt_number: 0, status },
      });
      // trigger payments_recompute_invoice tự tính lại invoice.paid_vnd
      const payload: PaymentEventPayload = { payment_id: paymentId, invoice_id: p.invoice_id };
      if (propertyId) payload.property_id = propertyId;
      await this.outbox.publish(tx, {
        event_type: 'payment.refunded',
        aggregate_type: 'payment',
        aggregate_id: paymentId,
        payload,
      });
      return tx.payments.findFirstOrThrow({ where: { id: paymentId } });
    });
    // TODO(task 4.5): audit log refund (reason, actor)
    return toPaymentResponse(updated);
  }

  /**
   * Ghi 1 payment SUCCEEDED TRONG tx có sẵn (đường ghi chung của record + đối
   * soát 3.4). Trigger DB cập nhật invoice.paid_vnd/status; cọc trả đủ → booking
   * CONFIRMED. `receivedBy=null` cho payment hệ thống (webhook). KHÔNG phân quyền
   * ở đây — caller chịu trách nhiệm authz/validate trước.
   */
  async applyPaymentInTx(
    tx: Tx,
    p: {
      tenantId: string;
      invoiceId: string;
      amountVnd: number;
      method: string;
      provider?: string;
      referenceCode?: string;
      receivedBy: string | null;
      idempotencyKey?: string;
    },
  ): Promise<payments> {
    const payment = await tx.payments.create({
      data: {
        tenant_id: p.tenantId,
        invoice_id: p.invoiceId,
        amount_vnd: p.amountVnd,
        method: p.method,
        status: 'SUCCEEDED',
        provider: p.provider,
        reference_code: p.referenceCode,
        received_by: p.receivedBy,
        received_at: new Date(),
        idempotency_key: p.idempotencyKey,
      },
    });
    await tx.payment_attempts.create({
      data: { tenant_id: p.tenantId, payment_id: payment.id, attempt_number: 1, status: 'SUCCEEDED' },
    });
    // trigger payments_recompute_invoice đã chạy → đọc lại invoice cho deposit→confirm
    const inv = await tx.invoices.findFirstOrThrow({
      where: { id: p.invoiceId },
      select: {
        status: true,
        kind: true,
        booking_id: true,
        bookings: { select: { property_id: true } },
      },
    });
    if (inv.status === 'PAID' && inv.kind === 'DEPOSIT' && inv.booking_id) {
      await this.bookings.confirmFromDepositPaid(tx, inv.booking_id, p.tenantId, p.receivedBy);
    }
    // payment.received (docs/10 §2) — đường ghi chung cho manual record + đối soát 3.4
    const payload: PaymentEventPayload = { payment_id: payment.id, invoice_id: p.invoiceId };
    if (inv.bookings?.property_id) payload.property_id = inv.bookings.property_id;
    if (inv.booking_id) payload.booking_id = inv.booking_id;
    await this.outbox.publish(tx, {
      event_type: 'payment.received',
      aggregate_type: 'payment',
      aggregate_id: payment.id,
      payload,
    });
    return payment;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async findByIdempotencyKey(tenantId: string, key: string): Promise<payments | null> {
    return withTenant(
      this.prisma,
      tenantId,
      (tx) => tx.payments.findFirst({ where: { idempotency_key: key } }),
      { readOnly: true },
    );
  }

  /** property_id (qua invoice→booking) để phân quyền refund; null nếu invoice ad-hoc. */
  private async loadPaymentProperty(paymentId: string, user: JwtClaims): Promise<string | null> {
    const row = await withTenant(
      this.prisma,
      user.tnt,
      (tx) =>
        tx.payments.findFirst({
          where: { id: paymentId },
          select: { invoices: { select: { bookings: { select: { property_id: true } } } } },
        }),
      { readOnly: true },
    );
    if (!row) {
      throw new AppException({ code: 'PAYMENT_NOT_FOUND', title: 'Payment không tồn tại', status: 404 });
    }
    return row.invoices?.bookings?.property_id ?? null;
  }
}
