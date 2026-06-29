import { Injectable, Logger } from '@nestjs/common';
import { type BookingEventPayload, type InvoiceEventPayload } from '@pms/shared-types';
import { Prisma } from '@prisma/client';
import { OutboxService } from '@core/outbox/outbox.service';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { AssetsService } from '@modules/assets/assets.service';
import { BillingService } from '@modules/billing/billing.service';
import { ExpensesService } from '@modules/expenses/expenses.service';
import { InvoicesService } from '@modules/invoices/invoices.service';
import { OccupancyService } from '@modules/occupancy/occupancy.service';

type Tx = Prisma.TransactionClient;

// docs/03 §7 — retention matrix (giữ nóng trong PG rồi cron delete)
const QUOTE_RETENTION_DAYS = 7; // quote hết hạn giữ 7 ngày
const SYNC_LOGS_RETENTION_DAYS = 30;
const SYNC_JOBS_RETENTION_DAYS = 90;
const NOTIFICATIONS_RETENTION_DAYS = 365; // 12 tháng
const PAYMENT_ATTEMPTS_RETENTION_DAYS = 365; // 12 tháng

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

export interface NightAuditSummary {
  deposit_timeouts: number;
  no_shows: number;
  deposits_forfeited: number;
  overdue_invoices: number;
  stats_rows: number;
  quotes_purged: number;
  retention_deleted: number;
  monthly: {
    period: string;
    depreciation_entries: number;
    recurring_expenses: number;
    monthly_invoices: number;
  } | null;
}

/**
 * ★ Night-audit (task 4.6, docs/03 §7 + docs/09 §8) — chạy mỗi đêm per-tenant.
 * Các bước daily idempotent trong 1 tx; bước tháng (ngày 1) gọi service 3.5/3.6/3.8
 * (mỗi cái mở withTenant riêng). Cron: night-audit.cron.ts. Test gọi runForTenant
 * trực tiếp (như sweepExpiredHolds).
 *
 * Forfeit cọc NO_SHOW (B1): khi CONFIRMED → NO_SHOW, nếu DEPOSIT đã thu thì sinh
 * ADJUSTMENT ghi nhận doanh thu tịch thu (DEPOSIT giữ PAID — docs/09 §4). No-show
 * tính theo timezone TỪNG cơ sở (không còn 1 mốc UTC). Retention dọn theo matrix
 * docs/03 §7: quote/sync_logs/sync_jobs/notifications/payment_attempts/idempotency_keys
 * per-tenant ở đây + outbox PROCESSED/FAILED cross-tenant ở MaintenanceService.
 */
@Injectable()
export class NightAuditService {
  private readonly logger = new Logger(NightAuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly occupancy: OccupancyService,
    private readonly assets: AssetsService,
    private readonly expenses: ExpensesService,
    private readonly billing: BillingService,
    private readonly invoices: InvoicesService,
    private readonly outbox: OutboxService,
  ) {}

  /** Quét toàn bộ tenant ACTIVE/TRIAL (cross-tenant platform job — ADR-0002 §5). */
  async runAllTenants(now: Date): Promise<number> {
    // eslint-disable-next-line no-restricted-syntax -- platform cross-tenant, bảng tenants non-RLS (ADR-0002 §5)
    const tenants = await this.prisma.tenants.findMany({
      where: { status: { in: ['TRIAL', 'ACTIVE'] } },
      select: { id: true },
    });
    for (const t of tenants) {
      await this.runForTenant(t.id, now);
    }
    return tenants.length;
  }

  /** Night-audit cho 1 tenant tại thời điểm `now`. */
  async runForTenant(tenantId: string, now: Date): Promise<NightAuditSummary> {
    const today = startOfUtcDay(now);
    const yesterday = addDays(today, -1);

    const summary = await withTenant(this.prisma, tenantId, async (tx) => {
      const deposit_timeouts = await this.cancelDepositTimeouts(tx, tenantId, now);
      const ns = await this.markNoShows(tx, tenantId, now);
      const overdue_invoices = await this.markOverdueInvoices(tx, today);
      const stats_rows = await this.rollupDailyStats(tx, tenantId, yesterday);
      const quotes_purged = await this.purgeExpiredQuotes(tx, now);
      const retention_deleted = await this.cleanupRetention(tx, now);
      return {
        deposit_timeouts,
        no_shows: ns.no_shows,
        deposits_forfeited: ns.deposits_forfeited,
        overdue_invoices,
        stats_rows,
        quotes_purged,
        retention_deleted,
      };
    });

    // Bước tháng (ngày 1) — chốt THÁNG VỪA KẾT THÚC (M-1). Mỗi service mở tx riêng.
    let monthly: NightAuditSummary['monthly'] = null;
    if (today.getUTCDate() === 1) {
      const prev = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const py = prev.getUTCFullYear();
      const pm = prev.getUTCMonth() + 1;
      const dep = await this.assets.runMonthlyDepreciation(tenantId, py, pm);
      const exp = await this.expenses.generateRecurringExpenses(tenantId, py, pm);
      const bill = await this.billing.runMonthlyBilling(tenantId, py, pm);
      monthly = {
        period: `${py}-${String(pm).padStart(2, '0')}`,
        depreciation_entries: dep.entries_created,
        recurring_expenses: exp.expenses_created,
        monthly_invoices: bill.invoices_created,
      };
    }

    const result: NightAuditSummary = { ...summary, monthly };
    this.logger.log(
      `Night-audit tenant ${tenantId}: timeout=${result.deposit_timeouts} no_show=${result.no_shows} forfeited=${result.deposits_forfeited} overdue=${result.overdue_invoices} stats=${result.stats_rows} quotes_purged=${result.quotes_purged} retention=${result.retention_deleted}${monthly ? ` monthly[${monthly.period}]=dep:${monthly.depreciation_entries}/exp:${monthly.recurring_expenses}/inv:${monthly.monthly_invoices}` : ''}`,
    );
    return result;
  }

  // ── ② PENDING quá hạn cọc → CANCELLED(DEPOSIT_TIMEOUT) + giải phóng phòng ──
  private async cancelDepositTimeouts(tx: Tx, tenantId: string, now: Date): Promise<number> {
    const expired = await tx.bookings.findMany({
      where: { status: 'PENDING', expires_at: { lt: now } },
      select: { id: true, property_id: true },
    });
    for (const b of expired) {
      await tx.bookings.update({
        where: { id: b.id },
        data: {
          status: 'CANCELLED',
          cancellation_reason: 'DEPOSIT_TIMEOUT',
          cancelled_at: now,
          version: { increment: 1 },
        },
      });
      await this.occupancy.deleteForBooking(tx, b.id);
      await tx.booking_status_history.create({
        data: {
          tenant_id: tenantId,
          booking_id: b.id,
          from_status: 'PENDING',
          to_status: 'CANCELLED',
          changed_by: null,
          reason: 'DEPOSIT_TIMEOUT',
        },
      });
      await this.outbox.publish(tx, {
        event_type: 'booking.cancelled',
        aggregate_type: 'booking',
        aggregate_id: b.id,
        payload: {
          booking_id: b.id,
          property_id: b.property_id,
          reason: 'DEPOSIT_TIMEOUT',
        } satisfies BookingEventPayload,
      });
    }
    return expired.length;
  }

  // ── ① CONFIRMED quá ngày check-in (theo TZ cơ sở) chưa đến → NO_SHOW + giải phóng + forfeit cọc ──
  private async markNoShows(
    tx: Tx,
    tenantId: string,
    now: Date,
  ): Promise<{ no_shows: number; deposits_forfeited: number }> {
    // Ngày nhận (LOCAL theo timezone TỪNG cơ sở) đã trôi qua so với "hôm nay" LOCAL
    // mà vẫn CONFIRMED → no-show. Per-property TZ thay cho 1 mốc UTC (docs/09 §8).
    const noShows = await tx.$queryRaw<{ id: string; property_id: string; booking_code: string }[]>`
      SELECT b.id, b.property_id, b.booking_code
      FROM bookings b
      JOIN properties p ON p.id = b.property_id
      WHERE b.status = 'CONFIRMED'
        AND (b.check_in AT TIME ZONE p.timezone)::date
            < (${now}::timestamptz AT TIME ZONE p.timezone)::date`;
    let deposits_forfeited = 0;
    for (const b of noShows) {
      await tx.bookings.update({
        where: { id: b.id },
        data: { status: 'NO_SHOW', version: { increment: 1 } },
      });
      await this.occupancy.deleteForBooking(tx, b.id);
      await tx.booking_status_history.create({
        data: {
          tenant_id: tenantId,
          booking_id: b.id,
          from_status: 'CONFIRMED',
          to_status: 'NO_SHOW',
          changed_by: null,
          reason: 'NO_SHOW',
        },
      });
      // Forfeit cọc đã thu → ADJUSTMENT (docs/09 §4); 0 nếu booking không có cọc.
      const forfeited = await this.invoices.forfeitDepositForBooking(tx, {
        id: b.id,
        tenant_id: tenantId,
        booking_code: b.booking_code,
      });
      if (forfeited > 0) deposits_forfeited++;
      await this.outbox.publish(tx, {
        event_type: 'booking.no_show',
        aggregate_type: 'booking',
        aggregate_id: b.id,
        payload: { booking_id: b.id, property_id: b.property_id } satisfies BookingEventPayload,
      });
    }
    return { no_shows: noShows.length, deposits_forfeited };
  }

  // ── ③ Invoice ISSUED/PARTIALLY_PAID quá due_date còn nợ → OVERDUE ──────────
  private async markOverdueInvoices(tx: Tx, today: Date): Promise<number> {
    const overdue = await tx.invoices.findMany({
      where: {
        status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
        due_date: { lt: today },
        balance_vnd: { gt: 0 },
      },
      select: { id: true, booking_id: true, bookings: { select: { property_id: true } } },
    });
    if (overdue.length === 0) return 0;
    await tx.invoices.updateMany({
      where: { id: { in: overdue.map((i) => i.id) } },
      data: { status: 'OVERDUE' },
    });
    for (const inv of overdue) {
      const payload: InvoiceEventPayload = { invoice_id: inv.id };
      if (inv.bookings?.property_id) payload.property_id = inv.bookings.property_id;
      if (inv.booking_id) payload.booking_id = inv.booking_id;
      await this.outbox.publish(tx, {
        event_type: 'invoice.overdue',
        aggregate_type: 'invoice',
        aggregate_id: inv.id,
        payload,
      });
    }
    return overdue.length;
  }

  // ── ④ Rollup daily_property_stats cho NGÀY VỪA QUA (idempotent upsert) ──────
  private async rollupDailyStats(tx: Tx, tenantId: string, statDate: Date): Promise<number> {
    const dayStart = startOfUtcDay(statDate);
    const dayEnd = addDays(dayStart, 1);
    const properties = await tx.properties.findMany({ select: { id: true } });

    for (const p of properties) {
      const available = await tx.rooms.count({ where: { property_id: p.id, is_active: true } });

      const occRows = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*)::bigint AS n
        FROM room_occupancy o
        JOIN rooms r ON r.tenant_id = o.tenant_id AND r.id = o.room_id
        WHERE r.property_id = ${p.id}::uuid AND o.booking_id IS NOT NULL
          AND o.period && tstzrange(${dayStart}, ${dayEnd}, '[)')`;
      const occupied = Number(occRows[0]?.n ?? 0);

      // Doanh thu phòng phân bổ đều /đêm (total_amount_vnd / số đêm), distinct booking
      const revRows = await tx.$queryRaw<{ revenue: bigint | null }[]>`
        SELECT COALESCE(SUM(
                 b.total_amount_vnd::numeric / GREATEST(1, (b.check_out::date - b.check_in::date))
               ), 0)::bigint AS revenue
        FROM (
          SELECT DISTINCT o.booking_id AS bid
          FROM room_occupancy o
          JOIN rooms r ON r.tenant_id = o.tenant_id AND r.id = o.room_id
          WHERE r.property_id = ${p.id}::uuid AND o.booking_id IS NOT NULL
            AND o.period && tstzrange(${dayStart}, ${dayEnd}, '[)')
        ) d
        JOIN bookings b ON b.id = d.bid`;
      const revenue = Number(revRows[0]?.revenue ?? 0);

      const adr = occupied > 0 ? Math.round(revenue / occupied) : null;
      const revpar = available > 0 ? Math.round(revenue / available) : null;

      await tx.daily_property_stats.upsert({
        where: {
          tenant_id_property_id_stat_date: {
            tenant_id: tenantId,
            property_id: p.id,
            stat_date: dayStart,
          },
        },
        create: {
          tenant_id: tenantId,
          property_id: p.id,
          stat_date: dayStart,
          available_room_nights: available,
          occupied_room_nights: occupied,
          room_revenue_vnd: revenue,
          other_revenue_vnd: 0,
          adr_vnd: adr,
          revpar_vnd: revpar,
        },
        update: {
          available_room_nights: available,
          occupied_room_nights: occupied,
          room_revenue_vnd: revenue,
          adr_vnd: adr,
          revpar_vnd: revpar,
          computed_at: new Date(),
        },
      });
    }
    return properties.length;
  }

  // ── ⑥ Retention: purge quote hết hạn > 7 ngày (docs/03 §7) ─────────────────
  private async purgeExpiredQuotes(tx: Tx, now: Date): Promise<number> {
    const cutoff = addDays(now, -QUOTE_RETENTION_DAYS);
    const res = await tx.quotes.deleteMany({ where: { expires_at: { lt: cutoff } } });
    return res.count;
  }

  // ── ⑦ Retention matrix per-tenant (docs/03 §7) — bảng RLS, dọn TRONG tx tenant ──
  // (outbox_events PROCESSED/FAILED là bảng global → MaintenanceService.runOutboxRetention)
  private async cleanupRetention(tx: Tx, now: Date): Promise<number> {
    const cutoff = (days: number): Date => addDays(now, -days);
    let total = 0;
    total += (await tx.idempotency_keys.deleteMany({ where: { expires_at: { lt: now } } })).count;
    // sync_logs TRƯỚC sync_jobs (FK sync_logs → sync_jobs)
    total += (await tx.sync_logs.deleteMany({ where: { created_at: { lt: cutoff(SYNC_LOGS_RETENTION_DAYS) } } }))
      .count;
    total += (await tx.sync_jobs.deleteMany({ where: { started_at: { lt: cutoff(SYNC_JOBS_RETENTION_DAYS) } } }))
      .count;
    total += (
      await tx.notifications.deleteMany({ where: { created_at: { lt: cutoff(NOTIFICATIONS_RETENTION_DAYS) } } })
    ).count;
    total += (
      await tx.payment_attempts.deleteMany({
        where: { created_at: { lt: cutoff(PAYMENT_ATTEMPTS_RETENTION_DAYS) } },
      })
    ).count;
    return total;
  }
}
