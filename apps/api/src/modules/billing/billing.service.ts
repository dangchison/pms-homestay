import { Injectable, Logger } from '@nestjs/common';
import {
  type JwtClaims,
  type MeterReadingResponse,
  type MonthlyBillingRunResult,
  type RecordMeterReadingRequest,
} from '@pms/shared-types';
import { roundVnd } from '@pms/pricing-engine';
import { Prisma, type bookings, type monthly_meter_readings } from '@prisma/client';
import { PermissionService } from '@core/auth/permission.service';
import { DocumentCounterService, periodOf } from '@core/counters/document-counter.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';

type Tx = Prisma.TransactionClient;

// ── Calendar math (UTC) ──────────────────────────────────────────────────────

/** TIMESTAMPTZ → ngày UTC (bỏ giờ) cho phép tính pro-rate theo ngày. */
function dateOnlyUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function dec(v: Prisma.Decimal | null): number | null {
  return v == null ? null : Number(v);
}

function toReadingResponse(r: monthly_meter_readings): MeterReadingResponse {
  return {
    id: r.id,
    booking_id: r.booking_id,
    period_year: r.period_year,
    period_month: r.period_month,
    electricity_kwh_start: dec(r.electricity_kwh_start),
    electricity_kwh_end: dec(r.electricity_kwh_end),
    water_m3_start: dec(r.water_m3_start),
    water_m3_end: dec(r.water_m3_end),
    created_at: r.created_at.toISOString(),
  };
}

interface LineItem {
  item_type: string;
  description: string;
  quantity: number;
  unit_price_vnd: number;
  amount_vnd: number;
}

/**
 * Billing thuê tháng (task 3.8, docs/09 §4.5). Ghi chỉ số điện/nước (staff) +
 * sinh invoice MONTHLY_RENT (tiền nhà pro-rate /30 + điện nước theo chỉ số).
 * `runMonthlyBilling` do night-audit 4.6 gọi ngày 1 hằng tháng.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly counters: DocumentCounterService,
  ) {}

  /** Ghi/sửa chỉ số điện nước 1 kỳ cho booking thuê tháng (upsert theo booking+kỳ). */
  async recordMeterReading(
    dto: RecordMeterReadingRequest,
    user: JwtClaims,
  ): Promise<MeterReadingResponse> {
    const booking = await this.loadBooking(dto.booking_id, user);
    await this.permissionService.authorizeOnProperty(user, booking.property_id, 'booking.update');
    if (booking.mode !== 'MONTHLY') {
      throw new AppException({
        code: 'BOOKING_NOT_MONTHLY',
        title: 'Chỉ booking thuê tháng mới ghi chỉ số điện nước',
        status: 422,
      });
    }
    const row = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.monthly_meter_readings.upsert({
        where: {
          booking_id_period_year_period_month: {
            booking_id: dto.booking_id,
            period_year: dto.period_year,
            period_month: dto.period_month,
          },
        },
        create: {
          tenant_id: user.tnt,
          booking_id: dto.booking_id,
          period_year: dto.period_year,
          period_month: dto.period_month,
          electricity_kwh_start: dto.electricity_kwh_start,
          electricity_kwh_end: dto.electricity_kwh_end,
          water_m3_start: dto.water_m3_start,
          water_m3_end: dto.water_m3_end,
          recorded_by: user.sub,
        },
        update: {
          electricity_kwh_start: dto.electricity_kwh_start,
          electricity_kwh_end: dto.electricity_kwh_end,
          water_m3_start: dto.water_m3_start,
          water_m3_end: dto.water_m3_end,
          recorded_by: user.sub,
        },
      }),
    );
    return toReadingResponse(row);
  }

  async listReadings(bookingId: string, user: JwtClaims): Promise<MeterReadingResponse[]> {
    const booking = await this.loadBooking(bookingId, user);
    await this.permissionService.authorizeOnProperty(user, booking.property_id, 'booking.read');
    const rows = await withTenant(
      this.prisma,
      user.tnt,
      (tx) =>
        tx.monthly_meter_readings.findMany({
          where: { booking_id: bookingId },
          orderBy: [{ period_year: 'asc' }, { period_month: 'asc' }],
        }),
      { readOnly: true },
    );
    return rows.map(toReadingResponse);
  }

  /**
   * ★ Sinh invoice MONTHLY_RENT cho kỳ (year,month) — gọi từ night-audit 4.6
   * ngày 1. Mỗi booking MONTHLY đang CHECKED_IN: tiền nhà = full tháng hoặc
   * pro-rate /30 (tháng đầu/cuối) + điện nước = (end−start) × đơn giá plan (nếu
   * không includes_utilities). Thiếu chỉ số cần tính → invoice DRAFT (chờ ghi +
   * notification 4.4). Idempotent theo (booking, billing_period) — bỏ qua nếu đã có.
   */
  async runMonthlyBilling(
    tenantId: string,
    year: number,
    month: number,
  ): Promise<MonthlyBillingRunResult> {
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const nextMonthStart = new Date(Date.UTC(year, month, 1));
    const periodStr = `${year}-${String(month).padStart(2, '0')}`;

    return withTenant(this.prisma, tenantId, async (tx) => {
      const bookingList = await tx.bookings.findMany({
        where: {
          mode: 'MONTHLY',
          status: 'CHECKED_IN',
          check_in: { lt: nextMonthStart }, // bắt đầu trước cuối kỳ
          check_out: { gt: monthStart }, // kết thúc sau đầu kỳ → có giao với kỳ
        },
      });

      let created = 0;
      let drafts = 0;
      for (const b of bookingList) {
        const exists = await tx.invoices.findFirst({
          where: {
            booking_id: b.id,
            kind: 'MONTHLY_RENT',
            billing_period: periodStr,
            status: { not: 'VOID' },
          },
          select: { id: true },
        });
        if (exists || !b.rate_plan_id) continue; // idempotent / không có gói giá

        const plan = await tx.rate_plans.findFirst({ where: { id: b.rate_plan_id } });
        if (!plan) continue;

        // Tiền nhà: full tháng hoặc pro-rate /30 (docs/09 §4.5)
        const checkIn = dateOnlyUtc(b.check_in);
        const checkOut = dateOnlyUtc(b.check_out);
        const effStart = checkIn > monthStart ? checkIn : monthStart;
        const effEnd = checkOut < nextMonthStart ? checkOut : nextMonthStart;
        if (effEnd <= effStart) continue; // không ở trong kỳ này
        const isFullMonth = checkIn <= monthStart && checkOut >= nextMonthStart;
        const baseRent = Number(plan.base_price_vnd);
        const rent = isFullMonth ? baseRent : roundVnd((baseRent * daysBetween(effStart, effEnd)) / 30);

        const items: LineItem[] = [
          {
            item_type: 'RENT_MONTHLY',
            description: `Tiền thuê tháng ${periodStr}${isFullMonth ? '' : ` (${daysBetween(effStart, effEnd)} ngày)`}`,
            quantity: 1,
            unit_price_vnd: rent,
            amount_vnd: rent,
          },
        ];

        // Điện nước (nếu gói không bao gồm + có đơn giá)
        let missingReading = false;
        if (!plan.monthly_includes_utilities) {
          const elecRate = plan.monthly_electricity_per_kwh_vnd
            ? Number(plan.monthly_electricity_per_kwh_vnd)
            : 0;
          const waterRate = plan.monthly_water_per_m3_vnd ? Number(plan.monthly_water_per_m3_vnd) : 0;
          if (elecRate > 0 || waterRate > 0) {
            const reading = await tx.monthly_meter_readings.findUnique({
              where: {
                booking_id_period_year_period_month: {
                  booking_id: b.id,
                  period_year: year,
                  period_month: month,
                },
              },
            });
            const hasElec = reading?.electricity_kwh_start != null && reading?.electricity_kwh_end != null;
            const hasWater = reading?.water_m3_start != null && reading?.water_m3_end != null;
            if (elecRate > 0 && hasElec) {
              const kwh = Number(reading!.electricity_kwh_end) - Number(reading!.electricity_kwh_start);
              items.push({
                item_type: 'ELECTRICITY',
                description: `Tiền điện ${kwh} kWh × ${elecRate}đ`,
                quantity: kwh,
                unit_price_vnd: elecRate,
                amount_vnd: roundVnd(kwh * elecRate),
              });
            }
            if (waterRate > 0 && hasWater) {
              const m3 = Number(reading!.water_m3_end) - Number(reading!.water_m3_start);
              items.push({
                item_type: 'WATER',
                description: `Tiền nước ${m3} m³ × ${waterRate}đ`,
                quantity: m3,
                unit_price_vnd: waterRate,
                amount_vnd: roundVnd(m3 * waterRate),
              });
            }
            if ((elecRate > 0 && !hasElec) || (waterRate > 0 && !hasWater)) missingReading = true;
          }
        }

        const number = await this.counters.nextCode(tx, tenantId, 'INV', periodOf(new Date()));
        const inv = await tx.invoices.create({
          data: {
            tenant_id: tenantId,
            booking_id: b.id,
            kind: 'MONTHLY_RENT',
            invoice_number: number,
            status: 'DRAFT',
            billing_period: periodStr,
          },
          select: { id: true },
        });
        let order = 0;
        for (const it of items) {
          await tx.invoice_items.create({
            data: {
              tenant_id: tenantId,
              invoice_id: inv.id,
              item_type: it.item_type,
              description: it.description,
              quantity: it.quantity,
              unit_price_vnd: it.unit_price_vnd,
              amount_vnd: it.amount_vnd,
              display_order: order++,
            },
          });
        }
        // Thiếu chỉ số → để DRAFT (TODO 4.4: notification nhắc ghi chỉ số); else ISSUED
        if (missingReading) {
          drafts++;
          this.logger.warn(
            `MONTHLY_RENT ${periodStr} booking ${b.booking_code}: thiếu chỉ số điện/nước → DRAFT`,
          );
        } else {
          await tx.invoices.update({
            where: { id: inv.id },
            data: { status: 'ISSUED', issued_at: new Date(), version: { increment: 1 } },
          });
        }
        created++;
      }

      if (created > 0) {
        this.logger.log(
          `Billing tháng ${periodStr}: ${created} invoice MONTHLY_RENT (tenant ${tenantId}; ${drafts} DRAFT thiếu chỉ số)`,
        );
      }
      return {
        period_year: year,
        period_month: month,
        bookings_considered: bookingList.length,
        invoices_created: created,
        drafts,
      };
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async loadBooking(id: string, user: JwtClaims): Promise<bookings> {
    const booking = await withTenant(
      this.prisma,
      user.tnt,
      (tx: Tx) => tx.bookings.findFirst({ where: { id } }),
      { readOnly: true },
    );
    if (!booking) {
      throw new AppException({ code: 'BOOKING_NOT_FOUND', title: 'Booking không tồn tại', status: 404 });
    }
    return booking;
  }
}
