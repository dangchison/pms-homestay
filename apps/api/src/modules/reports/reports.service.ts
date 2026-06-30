import { Injectable } from '@nestjs/common';
import {
  type BreakEvenQuery,
  type BreakEvenResponse,
  type BreakEvenScenario,
  type JwtClaims,
  type LandlordSettlementModel,
  type LandlordStatementQuery,
  type LandlordStatementResponse,
  type OccupancyDay,
  type OccupancyReportQuery,
  type OccupancyReportResponse,
  type PnlQuery,
  type PnlResponse,
} from '@pms/shared-types';
import { Prisma } from '@prisma/client';
import { PermissionService } from '@core/auth/permission.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { buildReportsWorkbook } from './reports-export.builder';

type Tx = Prisma.TransactionClient;

/** Chi phí TRỰC TIẾP (docs/09 §8) — phần còn lại là chi phí VẬN HÀNH. */
const DIRECT_TYPES = new Set([
  'RENT_LANDLORD',
  'ELECTRICITY',
  'WATER',
  'GAS',
  'AMENITIES',
  'CLEANING_SUPPLIES',
  'OTA_COMMISSION',
  'PLATFORM_FEE',
]);
/** Chi phí biến đổi /đêm cho break-even V_day (docs/09 §10). */
const VARIABLE_TYPES = new Set(['ELECTRICITY', 'WATER', 'GAS', 'AMENITIES', 'CLEANING_SUPPLIES']);
/** Chi phí cố định cho break-even F_fixed (+ khấu hao tháng). */
const FIXED_TYPES = new Set(['RENT_LANDLORD', 'STAFF_SALARY']);

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
/**
 * Prorate thuê tháng theo ngày overlap TỪNG tháng trong [from,to] (inclusive) —
 * landlord statement FIXED_RENT (docs/16 #14). Nguyên 1 tháng = nguyên tiền thuê;
 * nửa tháng = 1/2; kỳ nhiều tháng = cộng dồn theo số ngày mỗi tháng.
 */
function proratedMonthlyRent(monthlyRentVnd: number, from: string, to: string): number {
  const DAY = 86_400_000;
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  let total = 0;
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  for (;;) {
    const monthStart = new Date(Date.UTC(y, m, 1));
    const monthEnd = new Date(Date.UTC(y, m + 1, 0)); // ngày cuối tháng
    const daysInMonth = monthEnd.getUTCDate();
    const ovStart = monthStart > start ? monthStart : start;
    const ovEnd = monthEnd < end ? monthEnd : end;
    if (ovStart <= ovEnd) {
      const overlapDays = Math.round((ovEnd.getTime() - ovStart.getTime()) / DAY) + 1; // inclusive
      total += (monthlyRentVnd * overlapDays) / daysInMonth;
    }
    if (y === end.getUTCFullYear() && m === end.getUTCMonth()) break;
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return Math.round(total);
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
  ) {}

  /** P&L [from,to] — rollup quá khứ + live hôm nay; expenses/depreciation đọc trực tiếp. */
  async getPnl(query: PnlQuery, user: JwtClaims): Promise<PnlResponse> {
    await this.assertPropertyExists(query.property_id, user);
    await this.permissionService.authorizeOnProperty(user, query.property_id, 'report.financial');

    const todayStr = ymd(startOfUtcDay(new Date()));
    const fromDate = new Date(query.from);
    const toDate = new Date(query.to);
    // rollup chỉ tới ngày VỪA QUA; hôm nay (nếu trong khoảng) tính live
    const rollupTo = query.to < todayStr ? query.to : ymd(addDays(new Date(todayStr), -1));
    const includeToday = query.from <= todayStr && todayStr <= query.to;

    return withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        // ── Doanh thu + occupancy: rollup (quá khứ) ──
        let roomRevenue = 0;
        let otherRevenue = 0;
        let occupied = 0;
        let available = 0;
        if (query.from <= rollupTo) {
          const agg = await tx.daily_property_stats.aggregate({
            where: {
              property_id: query.property_id,
              stat_date: { gte: new Date(query.from), lte: new Date(rollupTo) },
            },
            _sum: {
              room_revenue_vnd: true,
              other_revenue_vnd: true,
              occupied_room_nights: true,
              available_room_nights: true,
            },
          });
          roomRevenue += Number(agg._sum.room_revenue_vnd ?? 0);
          otherRevenue += Number(agg._sum.other_revenue_vnd ?? 0);
          occupied += agg._sum.occupied_room_nights ?? 0;
          available += agg._sum.available_room_nights ?? 0;
        }
        // ── Live hôm nay (chưa rollup) ──
        if (includeToday) {
          const live = await this.computeLiveDay(tx, query.property_id, new Date(todayStr));
          roomRevenue += live.revenue;
          occupied += live.occupied;
          available += live.available;
        }

        // ── Chi phí vận hành theo loại ──
        const expRows = await tx.operational_expenses.groupBy({
          by: ['expense_type'],
          where: { property_id: query.property_id, expense_date: { gte: fromDate, lte: toDate } },
          _sum: { amount_vnd: true },
          orderBy: { expense_type: 'asc' },
        });
        const expenseByType: Record<string, number> = {};
        let directCost = 0;
        let operatingCost = 0;
        for (const r of expRows) {
          const amt = Number(r._sum.amount_vnd ?? 0);
          if (amt === 0) continue;
          expenseByType[r.expense_type] = amt;
          if (DIRECT_TYPES.has(r.expense_type)) directCost += amt;
          else operatingCost += amt;
        }

        // ── Khấu hao trong kỳ (theo period_year/month của asset thuộc property) ──
        const depreciation = await this.depreciationInRange(tx, query.property_id, query.from, query.to);
        if (depreciation > 0) {
          expenseByType.DEPRECIATION = depreciation;
          operatingCost += depreciation;
        }

        const revenueTotal = roomRevenue + otherRevenue;
        const grossProfit = revenueTotal - directCost;
        const operatingProfit = grossProfit - operatingCost;
        const taxEstimate = 0; // MVP: thuế ước tính để phase 2 (e-invoice/quyết toán)
        const netProfit = operatingProfit - taxEstimate;

        return {
          property_id: query.property_id,
          from: query.from,
          to: query.to,
          revenue_room_vnd: roomRevenue,
          revenue_other_vnd: otherRevenue,
          revenue_total_vnd: revenueTotal,
          direct_cost_vnd: directCost,
          gross_profit_vnd: grossProfit,
          operating_cost_vnd: operatingCost,
          depreciation_vnd: depreciation,
          operating_profit_vnd: operatingProfit,
          tax_estimate_vnd: taxEstimate,
          net_profit_vnd: netProfit,
          available_room_nights: available,
          occupied_room_nights: occupied,
          occupancy_rate_pct: available > 0 ? round1((occupied / available) * 100) : 0,
          adr_vnd: occupied > 0 ? Math.round(roomRevenue / occupied) : 0,
          revpar_vnd: available > 0 ? Math.round(roomRevenue / available) : 0,
          expense_by_type: expenseByType,
        } satisfies PnlResponse;
      },
      { readOnly: true },
    );
  }

  /** Break-even occupancy theo tháng (docs/09 §10). */
  async getBreakEven(query: BreakEvenQuery, user: JwtClaims): Promise<BreakEvenResponse> {
    await this.assertPropertyExists(query.property_id, user);
    await this.permissionService.authorizeOnProperty(user, query.property_id, 'report.financial');

    const [y, m] = query.period.split('-').map(Number) as [number, number];
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const nextMonthStart = new Date(Date.UTC(y, m, 1));
    const monthEnd = addDays(nextMonthStart, -1);

    return withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        // Stats kỳ hiện tại
        const cur = await tx.daily_property_stats.aggregate({
          where: { property_id: query.property_id, stat_date: { gte: monthStart, lte: monthEnd } },
          _sum: { room_revenue_vnd: true, occupied_room_nights: true, available_room_nights: true },
        });
        const roomRevenue = Number(cur._sum.room_revenue_vnd ?? 0);
        const occupied = cur._sum.occupied_room_nights ?? 0;
        const available = cur._sum.available_room_nights ?? 0;
        const currentAdr = occupied > 0 ? Math.round(roomRevenue / occupied) : 0;

        // ADR scenarios từ lịch sử daily_property_stats
        const win12From = new Date(Date.UTC(y - 1, m - 1, 1));
        const win6From = new Date(Date.UTC(y, m - 7, 1));
        const adr12 = await tx.daily_property_stats.aggregate({
          where: {
            property_id: query.property_id,
            stat_date: { gte: win12From, lte: monthEnd },
            adr_vnd: { not: null },
          },
          _min: { adr_vnd: true },
          _max: { adr_vnd: true },
        });
        const adr6 = await tx.daily_property_stats.aggregate({
          where: {
            property_id: query.property_id,
            stat_date: { gte: win6From, lte: monthEnd },
            adr_vnd: { not: null },
          },
          _avg: { adr_vnd: true },
        });
        const pessimisticAdr = adr12._min.adr_vnd != null ? Number(adr12._min.adr_vnd) : currentAdr;
        const optimisticAdr = adr12._max.adr_vnd != null ? Number(adr12._max.adr_vnd) : currentAdr;
        const realisticAdr = adr6._avg.adr_vnd != null ? Math.round(Number(adr6._avg.adr_vnd)) : currentAdr;

        // Chi phí kỳ: F_fixed (thuê + lương + khấu hao tháng), V_day (biến đổi / occupied)
        const expRows = await tx.operational_expenses.groupBy({
          by: ['expense_type'],
          where: { property_id: query.property_id, expense_date: { gte: monthStart, lte: monthEnd } },
          _sum: { amount_vnd: true },
          orderBy: { expense_type: 'asc' },
        });
        let fixedCost = 0;
        let variableCost = 0;
        for (const r of expRows) {
          const amt = Number(r._sum.amount_vnd ?? 0);
          if (FIXED_TYPES.has(r.expense_type)) fixedCost += amt;
          if (VARIABLE_TYPES.has(r.expense_type)) variableCost += amt;
        }
        const depreciation = await this.depreciationInRange(tx, query.property_id, ymd(monthStart), ymd(monthEnd));
        fixedCost += depreciation;
        const vDay = occupied > 0 ? Math.round(variableCost / occupied) : 0;

        const scenario = (adr: number): BreakEvenScenario => {
          const margin = adr - vDay;
          const pct = margin > 0 && available > 0 ? round1((fixedCost / (margin * available)) * 100) : null;
          return { adr_vnd: adr, break_even_occupancy_pct: pct };
        };

        return {
          property_id: query.property_id,
          period: query.period,
          available_room_nights: available,
          occupied_room_nights: occupied,
          current_occupancy_pct: available > 0 ? round1((occupied / available) * 100) : 0,
          current_adr_vnd: currentAdr,
          current_revpar_vnd: available > 0 ? Math.round(roomRevenue / available) : 0,
          fixed_cost_vnd: fixedCost,
          variable_cost_per_night_vnd: vDay,
          scenarios: {
            pessimistic: scenario(pessimisticAdr),
            realistic: scenario(realisticAdr),
            optimistic: scenario(optimisticAdr),
          },
        } satisfies BreakEvenResponse;
      },
      { readOnly: true },
    );
  }

  /**
   * Landlord statement (R2R, docs/16 #14) — báo cáo kỳ cho CHỦ NHÀ GỐC. Tái dùng
   * doanh thu/chi phí của getPnl; chọn mô hình thanh toán theo cấu hình property.
   * Thứ tự lỗi: 404 (không tồn tại / cross-tenant) → 403 (thiếu quyền) → 422 (không R2R).
   */
  async getLandlordStatement(
    query: LandlordStatementQuery,
    user: JwtClaims,
  ): Promise<LandlordStatementResponse> {
    const prop = await withTenant(
      this.prisma,
      user.tnt,
      (tx) =>
        tx.properties.findFirst({
          where: { id: query.property_id },
          select: {
            name: true,
            is_rent_to_rent: true,
            landlord_name: true,
            landlord_phone: true,
            rent_to_rent_contract_start: true,
            rent_to_rent_contract_end: true,
            monthly_landlord_rent_vnd: true,
            landlord_revenue_share_bp: true,
          },
        }),
      { readOnly: true },
    );
    if (!prop) {
      throw new AppException({ code: 'PROPERTY_NOT_FOUND', title: 'Cơ sở không tồn tại', status: 404 });
    }
    await this.permissionService.authorizeOnProperty(user, query.property_id, 'report.financial');
    if (!prop.is_rent_to_rent) {
      throw new AppException({
        code: 'NOT_RENT_TO_RENT',
        title: 'Cơ sở không phải rent-to-rent',
        detail: 'Báo cáo chủ nhà gốc chỉ áp dụng cho cơ sở thuê-lại (is_rent_to_rent = true).',
        status: 422,
      });
    }

    // Doanh thu + chi phí kỳ (getPnl authorize lại — rẻ, permission cache).
    const pnl = await this.getPnl(query, user);

    // Mô hình thanh toán: ưu tiên chia % doanh thu, kế đến thuê cố định, else chưa cấu hình.
    const shareBp = prop.landlord_revenue_share_bp;
    const monthlyRent =
      prop.monthly_landlord_rent_vnd == null ? null : Number(prop.monthly_landlord_rent_vnd);
    let settlementModel: LandlordSettlementModel;
    let payout: number;
    if (shareBp != null) {
      settlementModel = 'REVENUE_SHARE';
      payout = Math.round((pnl.revenue_total_vnd * shareBp) / 10_000);
    } else if (monthlyRent != null) {
      settlementModel = 'FIXED_RENT';
      payout = proratedMonthlyRent(monthlyRent, query.from, query.to);
    } else {
      settlementModel = 'NONE';
      payout = 0;
    }

    // Chi phí vận hành chưa gồm tiền thuê chủ nhà (tránh trùng với landlord_payout).
    const rentLandlordExpense = pnl.expense_by_type.RENT_LANDLORD ?? 0;
    const operatingCost = pnl.direct_cost_vnd + pnl.operating_cost_vnd - rentLandlordExpense;

    return {
      property_id: query.property_id,
      property_name: prop.name,
      from: query.from,
      to: query.to,
      landlord_name: prop.landlord_name,
      landlord_phone: prop.landlord_phone,
      contract_start: prop.rent_to_rent_contract_start
        ? ymd(prop.rent_to_rent_contract_start)
        : null,
      contract_end: prop.rent_to_rent_contract_end ? ymd(prop.rent_to_rent_contract_end) : null,
      revenue_room_vnd: pnl.revenue_room_vnd,
      revenue_other_vnd: pnl.revenue_other_vnd,
      revenue_total_vnd: pnl.revenue_total_vnd,
      operating_cost_vnd: operatingCost,
      settlement_model: settlementModel,
      revenue_share_bp: settlementModel === 'REVENUE_SHARE' ? shareBp : null,
      monthly_landlord_rent_vnd: settlementModel === 'FIXED_RENT' ? monthlyRent : null,
      landlord_payout_vnd: payout,
      available_room_nights: pnl.available_room_nights,
      occupied_room_nights: pnl.occupied_room_nights,
      occupancy_rate_pct: pnl.occupancy_rate_pct,
    } satisfies LandlordStatementResponse;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Doanh thu phòng + occupancy LIVE cho 1 ngày (chưa rollup) — cùng công thức night-audit. */
  private async computeLiveDay(
    tx: Tx,
    propertyId: string,
    dayStart: Date,
  ): Promise<{ occupied: number; available: number; revenue: number }> {
    const dayEnd = addDays(dayStart, 1);
    const available = await tx.rooms.count({ where: { property_id: propertyId, is_active: true } });
    const occRows = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n
      FROM room_occupancy o
      JOIN rooms r ON r.tenant_id = o.tenant_id AND r.id = o.room_id
      WHERE r.property_id = ${propertyId}::uuid AND o.booking_id IS NOT NULL
        AND o.period && tstzrange(${dayStart}, ${dayEnd}, '[)')`;
    const revRows = await tx.$queryRaw<{ revenue: bigint | null }[]>`
      SELECT COALESCE(SUM(
               b.total_amount_vnd::numeric / GREATEST(1, (b.check_out::date - b.check_in::date))
             ), 0)::bigint AS revenue
      FROM (
        SELECT DISTINCT o.booking_id AS bid
        FROM room_occupancy o
        JOIN rooms r ON r.tenant_id = o.tenant_id AND r.id = o.room_id
        WHERE r.property_id = ${propertyId}::uuid AND o.booking_id IS NOT NULL
          AND o.period && tstzrange(${dayStart}, ${dayEnd}, '[)')
      ) d
      JOIN bookings b ON b.id = d.bid`;
    return {
      occupied: Number(occRows[0]?.n ?? 0),
      available,
      revenue: Number(revRows[0]?.revenue ?? 0),
    };
  }

  /** Tổng khấu hao của các asset thuộc property, kỳ (year-month) trong [from,to]. */
  private async depreciationInRange(
    tx: Tx,
    propertyId: string,
    from: string,
    to: string,
  ): Promise<number> {
    const assets = await tx.assets.findMany({ where: { property_id: propertyId }, select: { id: true } });
    if (assets.length === 0) return 0;
    const fromKey = Number(from.slice(0, 4)) * 100 + Number(from.slice(5, 7));
    const toKey = Number(to.slice(0, 4)) * 100 + Number(to.slice(5, 7));
    const entries = await tx.depreciation_entries.findMany({
      where: { asset_id: { in: assets.map((a) => a.id) } },
      select: { period_year: true, period_month: true, amount_vnd: true },
    });
    let total = 0;
    for (const e of entries) {
      const key = e.period_year * 100 + e.period_month;
      if (key >= fromKey && key <= toKey) total += Number(e.amount_vnd);
    }
    return total;
  }

  /** Occupancy theo ngày (task 6.5, R3): đọc rollup daily_property_stats (night-audit fill). */
  async getOccupancy(query: OccupancyReportQuery, user: JwtClaims): Promise<OccupancyReportResponse> {
    await this.assertPropertyExists(query.property_id, user);
    await this.permissionService.authorizeOnProperty(user, query.property_id, 'report.financial');
    const rows = await withTenant(
      this.prisma,
      user.tnt,
      (tx) =>
        tx.daily_property_stats.findMany({
          where: {
            property_id: query.property_id,
            stat_date: { gte: new Date(query.from), lte: new Date(query.to) },
          },
          orderBy: { stat_date: 'asc' },
        }),
      { readOnly: true },
    );
    const days: OccupancyDay[] = rows.map((r) => ({
      stat_date: r.stat_date.toISOString().slice(0, 10),
      available_room_nights: r.available_room_nights,
      occupied_room_nights: r.occupied_room_nights,
      occupancy_rate_pct:
        r.available_room_nights > 0
          ? Math.round((r.occupied_room_nights / r.available_room_nights) * 1000) / 10
          : 0,
      adr_vnd: Number(r.adr_vnd ?? 0n),
      revpar_vnd: Number(r.revpar_vnd ?? 0n),
      room_revenue_vnd: Number(r.room_revenue_vnd),
    }));
    return { property_id: query.property_id, from: query.from, to: query.to, days };
  }

  /**
   * Xuất Excel báo cáo (A3 F3 — phần 2): gộp P&L + occupancy của [from,to] vào 1
   * workbook. Tái dùng getPnl/getOccupancy (đã authorize + đọc rollup) → builder
   * thuần. Trả buffer + tên file gợi ý cho Content-Disposition. [[reports-export.builder]]
   */
  async exportXlsx(
    query: OccupancyReportQuery,
    user: JwtClaims,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const [pnl, occupancy, propertyName] = await Promise.all([
      this.getPnl(query, user),
      this.getOccupancy(query, user),
      this.getPropertyName(query.property_id, user),
    ]);
    const buffer = await buildReportsWorkbook({
      property_name: propertyName,
      from: query.from,
      to: query.to,
      pnl,
      occupancy,
    });
    return { buffer, filename: `bao-cao-${query.from}_${query.to}.xlsx` };
  }

  /** Tên cơ sở (đã authorize qua getPnl/getOccupancy) — cho tiêu đề file. */
  private async getPropertyName(propertyId: string, user: JwtClaims): Promise<string> {
    const prop = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.properties.findFirst({ where: { id: propertyId }, select: { name: true } }),
      { readOnly: true },
    );
    return prop?.name ?? 'Cơ sở';
  }

  private async assertPropertyExists(propertyId: string, user: JwtClaims): Promise<void> {
    const prop = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.properties.findFirst({ where: { id: propertyId }, select: { id: true } }),
      { readOnly: true },
    );
    if (!prop) {
      throw new AppException({
        code: 'PROPERTY_NOT_FOUND',
        title: 'Cơ sở không tồn tại',
        status: 404,
      });
    }
  }
}
