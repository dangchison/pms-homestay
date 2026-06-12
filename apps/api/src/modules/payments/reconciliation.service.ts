import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  type JwtClaims,
  type PaymentWebhook,
  type UnmatchedPaymentResponse,
} from '@pms/shared-types';
import { type Prisma, type unmatched_payments } from '@prisma/client';
import { Queue } from 'bullmq';
import { QUEUE_PAYMENT_RECONCILE } from '@core/bullmq/queues';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { PaymentsService } from './payments.service';

const PAYABLE = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] as const;
const CODE_RE = /(INV|BK)-\d{6}-\d{4}/;

function toUnmatchedResponse(u: unmatched_payments): UnmatchedPaymentResponse {
  return {
    id: u.id,
    provider: u.provider,
    transaction_ref: u.transaction_ref,
    amount_vnd: Number(u.amount_vnd),
    content: u.content,
    bank_account: u.bank_account,
    received_at: u.received_at ? u.received_at.toISOString() : null,
    status: u.status as UnmatchedPaymentResponse['status'],
    resolved_payment_id: u.resolved_payment_id,
    created_at: u.created_at.toISOString(),
  };
}

/**
 * ★ Đối soát thanh toán (docs/09 §5, task 3.4). Webhook public dedup + enqueue;
 * worker resolve tenant (theo TK nhận) → match đa tiêu chí có confidence:
 * code (BK/INV) + amount khớp số dư → auto-confirm (đường ghi payment 3.3);
 * còn lại → unmatched_payments cho host đối soát tay.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    @InjectQueue(QUEUE_PAYMENT_RECONCILE) private readonly queue: Queue,
  ) {}

  /** Webhook handler: dedup (PK source+event_id) + enqueue job. Trả isNew=false nếu trùng. */
  async acceptWebhook(provider: string, payload: PaymentWebhook): Promise<{ isNew: boolean }> {
    const source = provider.toUpperCase();
    try {
      // dedup cross-tenant (bảng không RLS — webhook chạy trước khi biết tenant)
      // eslint-disable-next-line no-restricted-syntax -- platform dedup, bảng non-RLS (docs/03 §4.6)
      await this.prisma.webhook_events_received.create({
        data: { source, event_id: payload.event_id },
      });
    } catch {
      return { isNew: false }; // PK conflict → đã nhận
    }
    // jobId KHÔNG được chứa ':' (BullMQ) → dùng '__'
    await this.queue.add('reconcile', { provider: source, payload }, { jobId: `${source}__${payload.event_id}` });
    return { isNew: true };
  }

  /** Worker: resolve tenant → match → auto-confirm hoặc unmatched. */
  async reconcile(provider: string, payload: PaymentWebhook): Promise<{ matched: boolean }> {
    const tenantId = await this.resolveTenantByBankAccount(payload.bank_account);
    if (!tenantId) {
      this.logger.warn(`Webhook ${provider}/${payload.event_id}: TK ${payload.bank_account} không thuộc cơ sở nào`);
      await this.markProcessed(provider, payload.event_id, null);
      return { matched: false };
    }

    const matched = await withTenant(this.prisma, tenantId, async (tx) => {
      const invoiceId = await this.matchInvoice(tx, payload);
      if (invoiceId) {
        await this.payments.applyPaymentInTx(tx, {
          tenantId,
          invoiceId,
          amountVnd: payload.amount_vnd,
          method: 'VIETQR',
          provider: provider.toUpperCase(),
          referenceCode: payload.event_id,
          receivedBy: null, // hệ thống (đối soát tự động)
        });
        return true;
      }
      // chưa khớp → ghi unmatched (idempotent theo (tenant, provider, transaction_ref))
      const exists = await tx.unmatched_payments.findFirst({
        where: { provider: provider.toUpperCase(), transaction_ref: payload.event_id },
        select: { id: true },
      });
      if (!exists) {
        await tx.unmatched_payments.create({
          data: {
            tenant_id: tenantId,
            provider: provider.toUpperCase(),
            transaction_ref: payload.event_id,
            amount_vnd: payload.amount_vnd,
            content: payload.content,
            bank_account: payload.bank_account,
            received_at: payload.received_at ? new Date(payload.received_at) : new Date(),
            raw: payload,
          },
        });
      }
      return false;
    });
    await this.markProcessed(provider, payload.event_id, tenantId);
    // payment.received (task 4.3) emit TRONG applyPaymentInTx (đường ghi chung) → cả
    // đối soát tự động lẫn manual record đều phát event; không emit lại ở đây.
    return { matched };
  }

  async listUnmatched(user: JwtClaims): Promise<UnmatchedPaymentResponse[]> {
    const rows = await withTenant(
      this.prisma,
      user.tnt,
      (tx) =>
        tx.unmatched_payments.findMany({ where: { status: 'PENDING' }, orderBy: { created_at: 'desc' } }),
      { readOnly: true },
    );
    return rows.map(toUnmatchedResponse);
  }

  /** Gán giao dịch chưa khớp vào 1 invoice → tạo payment (đường ghi 3.3) + RESOLVED. */
  async resolve(id: string, invoiceId: string, user: JwtClaims): Promise<UnmatchedPaymentResponse> {
    const updated = await withTenant(this.prisma, user.tnt, async (tx) => {
      const um = await tx.unmatched_payments.findFirst({ where: { id } });
      if (!um) {
        throw new AppException({ code: 'UNMATCHED_NOT_FOUND', title: 'Giao dịch không tồn tại', status: 404 });
      }
      if (um.status !== 'PENDING') {
        throw new AppException({
          code: 'UNMATCHED_NOT_PENDING',
          title: `Giao dịch đã ${um.status}`,
          status: 422,
        });
      }
      const inv = await tx.invoices.findFirst({
        where: { id: invoiceId },
        select: { status: true },
      });
      if (!inv) {
        throw new AppException({ code: 'INVOICE_NOT_FOUND', title: 'Hoá đơn không tồn tại', status: 404 });
      }
      if (!PAYABLE.includes(inv.status as (typeof PAYABLE)[number])) {
        throw new AppException({
          code: 'INVOICE_NOT_PAYABLE',
          title: `Hoá đơn ${inv.status} không nhận thanh toán`,
          status: 422,
        });
      }
      const payment = await this.payments.applyPaymentInTx(tx, {
        tenantId: user.tnt,
        invoiceId,
        amountVnd: Number(um.amount_vnd),
        method: 'BANK_TRANSFER',
        provider: um.provider,
        referenceCode: um.transaction_ref,
        receivedBy: user.sub,
      });
      return tx.unmatched_payments.update({
        where: { id },
        data: { status: 'RESOLVED', resolved_payment_id: payment.id, resolved_by: user.sub },
      });
    });
    return toUnmatchedResponse(updated);
  }

  async ignore(id: string, user: JwtClaims): Promise<UnmatchedPaymentResponse> {
    const updated = await withTenant(this.prisma, user.tnt, async (tx) => {
      const result = await tx.unmatched_payments.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'IGNORED', resolved_by: user.sub },
      });
      if (result.count === 0) {
        throw new AppException({
          code: 'UNMATCHED_NOT_PENDING',
          title: 'Giao dịch không tồn tại hoặc đã xử lý',
          status: 422,
        });
      }
      return tx.unmatched_payments.findFirstOrThrow({ where: { id } });
    });
    return toUnmatchedResponse(updated);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Tìm 1 invoice còn nợ khớp content (mã BK/INV) + amount == số dư. Else null → unmatched. */
  private async matchInvoice(
    tx: Prisma.TransactionClient,
    payload: PaymentWebhook,
  ): Promise<string | null> {
    const code = CODE_RE.exec(payload.content)?.[0];
    if (!code) return null; // không có mã → không auto (đối soát tay)

    let candidates: { id: string; total_vnd: bigint; paid_vnd: bigint }[];
    if (code.startsWith('INV-')) {
      const inv = await tx.invoices.findFirst({
        where: { invoice_number: code, status: { in: [...PAYABLE] } },
        select: { id: true, total_vnd: true, paid_vnd: true },
      });
      candidates = inv ? [inv] : [];
    } else {
      const booking = await tx.bookings.findFirst({
        where: { booking_code: code },
        select: { id: true },
      });
      candidates = booking
        ? await tx.invoices.findMany({
            where: { booking_id: booking.id, status: { in: [...PAYABLE] } },
            select: { id: true, total_vnd: true, paid_vnd: true },
          })
        : [];
    }
    const exact = candidates.filter(
      (i) => Number(i.total_vnd) - Number(i.paid_vnd) === payload.amount_vnd,
    );
    return exact.length === 1 ? exact[0]!.id : null; // 0 hoặc nhiều → ambiguous → unmatched
  }

  /** TK nhận → tenant (lặp tenant active — bảng properties có RLS nên không query chéo trực tiếp). */
  private async resolveTenantByBankAccount(bankAccount: string): Promise<string | null> {
    // eslint-disable-next-line no-restricted-syntax -- platform cross-tenant, bảng non-RLS (ADR-0002 §5)
    const tenants = await this.prisma.tenants.findMany({
      where: { status: { in: ['TRIAL', 'ACTIVE'] } },
      select: { id: true },
    });
    for (const t of tenants) {
      const prop = await withTenant(
        this.prisma,
        t.id,
        (tx) =>
          tx.properties.findFirst({
            where: { bank_account_number: bankAccount },
            select: { id: true },
          }),
        { readOnly: true },
      );
      if (prop) return t.id;
    }
    return null;
  }

  private async markProcessed(provider: string, eventId: string, tenantId: string | null): Promise<void> {
    // eslint-disable-next-line no-restricted-syntax -- platform dedup, bảng non-RLS (docs/03 §4.6)
    await this.prisma.webhook_events_received.update({
      where: { source_event_id: { source: provider.toUpperCase(), event_id: eventId } },
      data: { processed_at: new Date(), tenant_id: tenantId },
    });
  }
}
