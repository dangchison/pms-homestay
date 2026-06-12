import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { AssetsService } from '@modules/assets/assets.service';
import { BillingService } from '@modules/billing/billing.service';
import { ExpensesService } from '@modules/expenses/expenses.service';
import { OccupancyService } from '@modules/occupancy/occupancy.service';

type Tx = Prisma.TransactionClient;

const QUOTE_RETENTION_DAYS = 7; // docs/03 §7: quote hết hạn giữ 7 ngày rồi purge

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
  overdue_invoices: number;
  stats_rows: number;
  quotes_purged: number;
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
 * TODO(forfeit cọc NO_SHOW): hiện chỉ chuyển trạng thái + giải phóng phòng; cấn/
 * tịch thu cọc theo chính sách → ADJUSTMENT invoice (mở rộng sau). Retention mới
 * phủ quote hết hạn; matrix đầy đủ (docs/03 §7) bổ sung dần.
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
      const no_shows = await this.markNoShows(tx, tenantId, today);
      const overdue_invoices = await this.markOverdueInvoices(tx, today);
      const stats_rows = await this.rollupDailyStats(tx, tenantId, yesterday);
      const quotes_purged = await this.purgeExpiredQuotes(tx, now);
      return { deposit_timeouts, no_shows, overdue_invoices, stats_rows, quotes_purged };
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
      `Night-audit tenant ${tenantId}: timeout=${result.deposit_timeouts} no_show=${result.no_shows} overdue=${result.overdue_invoices} stats=${result.stats_rows} quotes_purged=${result.quotes_purged}${monthly ? ` monthly[${monthly.period}]=dep:${monthly.depreciation_entries}/exp:${monthly.recurring_expenses}/inv:${monthly.monthly_invoices}` : ''}`,
    );
    return result;
  }

  // ── ② PENDING quá hạn cọc → CANCELLED(DEPOSIT_TIMEOUT) + giải phóng phòng ──
  private async cancelDepositTimeouts(tx: Tx, tenantId: string, now: Date): Promise<number> {
    const expired = await tx.bookings.findMany({
      where: { status: 'PENDING', expires_at: { lt: now } },
      select: { id: true },
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
    }
    return expired.length;
  }

  // ── ① CONFIRMED quá ngày check-in mà chưa đến → NO_SHOW + giải phóng phòng ──
  private async markNoShows(tx: Tx, tenantId: string, today: Date): Promise<number> {
    // check_in trước 00:00 hôm nay (ngày nhận phòng đã trôi qua) mà vẫn CONFIRMED
    const noShows = await tx.bookings.findMany({
      where: { status: 'CONFIRMED', check_in: { lt: today } },
      select: { id: true },
    });
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
    }
    return noShows.length;
  }

  // ── ③ Invoice ISSUED/PARTIALLY_PAID quá due_date còn nợ → OVERDUE ──────────
  private async markOverdueInvoices(tx: Tx, today: Date): Promise<number> {
    const res = await tx.invoices.updateMany({
      where: {
        status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
        due_date: { lt: today },
        balance_vnd: { gt: 0 },
      },
      data: { status: 'OVERDUE' },
    });
    return res.count;
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
}
