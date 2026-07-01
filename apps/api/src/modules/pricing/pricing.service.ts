import { Injectable } from '@nestjs/common';
import {
  type JwtClaims,
  type QuoteLineItem,
  type QuoteRequest,
  type QuoteResponse,
} from '@pms/shared-types';
import {
  PricingError,
  localDate,
  quote as computeQuote,
  type Quote as EngineQuote,
} from '@pms/pricing-engine';
import { Prisma, type quotes, type rate_plans } from '@prisma/client';
import { PermissionService } from '@core/auth/permission.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { DiscountsService } from '@modules/discounts/discounts.service';
import { holidayRowToEngine, toApiLineItem, toRatePlanConfig } from './pricing.mappers';

type Tx = Prisma.TransactionClient;

const QUOTE_TTL_MS = 15 * 60 * 1000; // docs/07 §6
const PURGE_AFTER_DAYS = 7; // docs/03 §7 — cron night-audit (4.6) gọi

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly discounts: DiscountsService,
  ) {}

  /**
   * POST /pricing/quote (docs/07 §6): tính giá bằng pricing-engine + INSERT bảng
   * `quotes` (snapshot rate_plan_version, line_items, expires 15'). Persist DB —
   * KHÔNG Redis. Booking (2.6) gửi quote_id → re-calculate so khớp.
   */
  async quote(dto: QuoteRequest, user: JwtClaims): Promise<QuoteResponse> {
    const checkIn = new Date(dto.check_in);
    const checkOut = new Date(dto.check_out);

    const resource = await this.loadResource(dto.resource_id, user);
    await this.permissionService.authorizeOnProperty(user, resource.property_id, 'booking.create');

    return withTenant(this.prisma, user.tnt, async (tx) => {
      const property = await tx.properties.findFirst({
        where: { id: resource.property_id },
        select: { timezone: true },
      });
      const timezone = property?.timezone ?? 'Asia/Ho_Chi_Minh';

      const plan = await this.resolvePlan(tx, resource, dto.mode, dto.rate_plan_id);
      const engineQuote = await this.computeForPlan(tx, plan, timezone, {
        mode: dto.mode,
        checkIn,
        checkOut,
        adults: dto.adults,
        children: dto.children,
      });

      const lineItems = engineQuote.lineItems.map(toApiLineItem);

      // Voucher (task 9.4c) — CHỈ khi client gửi discount_code (path không mã byte-identical
      // như trước). Áp CÙNG tx (RLS đã set) trên property ĐÃ-RESOLVE của quote — KHÔNG dùng
      // property client gửi. Mã KHÔNG hợp lệ → 422 DISCOUNT_NOT_APPLICABLE NÉM TRƯỚC khi INSERT
      // → KHÔNG quote nào được persist (báo giá nguyên tử: áp sạch hoặc từ chối, để booking sau
      // không âm thầm rớt voucher). Số tiền voucher tính DUY NHẤT ở DiscountsService.evaluate →
      // khớp endpoint validate. discount_vnd = engine + voucher; total = subtotal - discount + tax.
      let discountVnd = engineQuote.discountVnd;
      let totalVnd = engineQuote.totalVnd;
      let discountCodeId: string | null = null;
      if (dto.discount_code) {
        const applied = await this.discounts.applyDiscountInTx(tx, dto.discount_code, {
          subtotalVnd: BigInt(engineQuote.subtotalVnd),
          propertyId: resource.property_id,
        });
        if (!applied.valid || applied.code_id === null) {
          throw new AppException({
            code: 'DISCOUNT_NOT_APPLICABLE',
            title: 'Mã giảm giá không áp dụng được cho báo giá này',
            status: 422,
            detail: applied.reason_code,
          });
        }
        discountCodeId = applied.code_id;
        discountVnd = engineQuote.discountVnd + applied.discount_vnd;
        totalVnd = engineQuote.subtotalVnd - discountVnd + engineQuote.taxVnd;
        lineItems.push({
          type: 'DISCOUNT',
          description: `Mã giảm giá ${dto.discount_code}`,
          quantity: 1,
          unit_price_vnd: -applied.discount_vnd,
          amount_vnd: -applied.discount_vnd,
        } satisfies QuoteLineItem);
      }

      const expiresAt = new Date(Date.now() + QUOTE_TTL_MS);
      const row = await tx.quotes.create({
        data: {
          tenant_id: user.tnt,
          property_id: resource.property_id,
          resource_id: resource.id,
          rate_plan_id: plan.id,
          rate_plan_version: plan.version,
          mode: dto.mode,
          check_in: checkIn,
          check_out: checkOut,
          adults: dto.adults ?? 1,
          children: dto.children ?? 0,
          line_items: lineItems as unknown as Prisma.InputJsonValue,
          subtotal_vnd: BigInt(engineQuote.subtotalVnd),
          discount_vnd: BigInt(discountVnd),
          tax_vnd: BigInt(engineQuote.taxVnd),
          total_vnd: BigInt(totalVnd),
          discount_code_id: discountCodeId,
          expires_at: expiresAt,
        },
      });

      return {
        quote_id: row.id,
        property_id: resource.property_id,
        resource_id: resource.id,
        rate_plan_id: plan.id,
        rate_plan_version: plan.version,
        mode: dto.mode,
        check_in: checkIn.toISOString(),
        check_out: checkOut.toISOString(),
        adults: row.adults,
        children: row.children,
        line_items: lineItems,
        subtotal_vnd: engineQuote.subtotalVnd,
        discount_vnd: discountVnd,
        tax_vnd: engineQuote.taxVnd,
        total_vnd: totalVnd,
        deposit_vnd: engineQuote.depositVnd,
        expires_at: expiresAt.toISOString(),
        holidays: engineQuote.holidays.map((h) => ({ date: h.date, name: h.name })),
        ...(dto.discount_code ? { discount_code: dto.discount_code } : {}),
      };
    });
  }

  /** Dọn quote hết hạn > 7 ngày chưa dùng (night-audit 4.6 gọi per tenant). */
  async purgeExpired(tenantId: string): Promise<number> {
    const cutoff = new Date(Date.now() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await withTenant(this.prisma, tenantId, (tx) =>
      tx.quotes.deleteMany({
        where: { expires_at: { lt: cutoff }, used_by_booking_id: null },
      }),
    );
    return count;
  }

  /**
   * ★ Verify quote khi tạo booking (docs/07 §6) — gọi TRONG tx booking (2.6).
   * Re-calculate bằng plan hiện tại, lệch giá / hết hạn → 409 PRICE_CHANGED;
   * sai resource/khoảng/chế độ → 422; đã dùng → 409. Trả quote row nếu hợp lệ.
   */
  async verifyQuoteForBooking(
    tx: Tx,
    quoteId: string,
    expect: { resourceId: string; checkIn: Date; checkOut: Date; mode: QuoteRequest['mode'] },
  ): Promise<quotes> {
    const quote = await tx.quotes.findFirst({ where: { id: quoteId } });
    if (!quote) {
      throw new AppException({ code: 'QUOTE_NOT_FOUND', title: 'Báo giá không tồn tại', status: 404 });
    }
    if (quote.used_by_booking_id) {
      throw new AppException({
        code: 'QUOTE_ALREADY_USED',
        title: 'Báo giá đã dùng cho booking khác',
        status: 409,
      });
    }
    if (
      quote.resource_id !== expect.resourceId ||
      quote.mode !== expect.mode ||
      quote.check_in.getTime() !== expect.checkIn.getTime() ||
      quote.check_out.getTime() !== expect.checkOut.getTime()
    ) {
      throw new AppException({
        code: 'QUOTE_MISMATCH',
        title: 'Báo giá không khớp resource/khoảng thời gian',
        status: 422,
      });
    }
    const priceChanged = (detail: string): AppException =>
      new AppException({
        code: 'PRICE_CHANGED',
        title: 'Giá đã thay đổi — vui lòng báo giá lại',
        status: 409,
        detail,
      });
    if (quote.expires_at.getTime() < Date.now()) throw priceChanged('quote đã hết hạn');

    const property = await tx.properties.findFirst({
      where: { id: quote.property_id },
      select: { timezone: true },
    });
    const plan = await tx.rate_plans.findFirst({ where: { id: quote.rate_plan_id } });
    if (!plan) throw priceChanged('gói giá không còn');
    const recalculated = await this.computeForPlan(
      tx,
      plan,
      property?.timezone ?? 'Asia/Ho_Chi_Minh',
      { mode: quote.mode, checkIn: quote.check_in, checkOut: quote.check_out, adults: quote.adults, children: quote.children },
    );
    // ★ So khớp VÔ-CẢM-VOUCHER (task 9.4c): engine KHÔNG biết voucher nên recalculated.totalVnd
    // là tổng TRƯỚC voucher. quote.total_vnd đã trừ voucher → phải CỘNG LẠI phần voucher trước khi
    // so, nếu không MỌI booking có voucher sẽ 409 PRICE_CHANGED oan. voucherPortion = phần discount
    // của quote VƯỢT engine hiện tại = Number(quote.discount_vnd) - recalculated.discountVnd (khi
    // không voucher: quote.discount_vnd == engine → phần = 0 → so y hệt trước). Đổi giá thật (rate
    // thay đổi) vẫn 409 vì recalculated.totalVnd lệch tổng-trước-voucher của quote.
    const voucherPortion = Number(quote.discount_vnd) - recalculated.discountVnd;
    const preVoucherQuoteTotal = Number(quote.total_vnd) + voucherPortion;
    if (recalculated.totalVnd !== preVoucherQuoteTotal) {
      throw priceChanged(`giá mới ${recalculated.totalVnd} ≠ báo giá ${preVoucherQuoteTotal}`);
    }
    return quote;
  }

  /**
   * Tính lại tổng tiền cho khoảng ngày mới của một booking (A3 F3 — reschedule).
   * Gọi TRONG tx booking: load rate_plan + chạy engine với check_in/out mới. Dùng
   * khi kéo mép lịch đổi số đêm → giá đổi theo. Plan không còn → 422.
   */
  async recomputeTotal(
    tx: Tx,
    ratePlanId: string,
    timezone: string,
    params: { mode: QuoteRequest['mode']; checkIn: Date; checkOut: Date; adults: number; children: number },
  ): Promise<number> {
    const plan = await tx.rate_plans.findFirst({ where: { id: ratePlanId } });
    if (!plan) {
      throw new AppException({
        code: 'RATE_PLAN_NOT_FOUND',
        title: 'Gói giá không còn — không tính lại được giá',
        status: 422,
      });
    }
    const recalculated = await this.computeForPlan(tx, plan, timezone, params);
    return recalculated.totalVnd;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Load rules + holidays cho plan rồi chạy engine (dùng chung quote + verify). */
  private async computeForPlan(
    tx: Tx,
    plan: rate_plans,
    timezone: string,
    params: { mode: QuoteRequest['mode']; checkIn: Date; checkOut: Date; adults?: number; children?: number },
  ): Promise<EngineQuote> {
    const rules = await tx.rate_plan_rules.findMany({ where: { rate_plan_id: plan.id } });
    const holidayRows = await tx.vietnam_holidays.findMany({
      where: {
        holiday_date: {
          gte: new Date(`${localDate(params.checkIn, timezone)}T00:00:00.000Z`),
          lte: new Date(`${localDate(params.checkOut, timezone)}T00:00:00.000Z`),
        },
      },
    });
    try {
      return computeQuote(
        {
          mode: params.mode,
          checkIn: params.checkIn,
          checkOut: params.checkOut,
          adults: params.adults,
          children: params.children,
        },
        toRatePlanConfig(plan, rules, timezone),
        holidayRows.map(holidayRowToEngine),
      );
    } catch (err) {
      if (err instanceof PricingError) {
        throw new AppException({
          code: `PRICING_${err.code}`,
          title: 'Không tính được giá',
          status: 422,
          detail: err.message,
        });
      }
      throw err;
    }
  }

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

  /**
   * Gói giá áp cho quote: rate_plan_id tường minh (verify cùng property + mode +
   * active) hoặc gói gán cho resource (ưu tiên default) → fallback gói mặc định
   * của property cho mode. Không có → 422.
   */
  private async resolvePlan(
    tx: Tx,
    resource: { id: string; property_id: string },
    mode: string,
    ratePlanId?: string,
  ): Promise<rate_plans> {
    if (ratePlanId) {
      const plan = await tx.rate_plans.findFirst({ where: { id: ratePlanId } });
      if (!plan || plan.property_id !== resource.property_id || plan.mode !== mode || !plan.is_active) {
        throw new AppException({
          code: 'RATE_PLAN_INVALID',
          title: 'Gói giá không hợp lệ cho resource/chế độ này',
          status: 422,
        });
      }
      return plan;
    }

    const assigned = await tx.rate_plan_resources.findMany({
      where: { resource_id: resource.id },
      select: { rate_plan_id: true },
    });
    if (assigned.length > 0) {
      const plans = await tx.rate_plans.findMany({
        where: { id: { in: assigned.map((a) => a.rate_plan_id) }, mode: mode as never, is_active: true },
        orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
      });
      if (plans[0]) return plans[0];
    }

    const fallback = await tx.rate_plans.findFirst({
      where: { property_id: resource.property_id, mode: mode as never, is_default: true, is_active: true },
    });
    if (!fallback) {
      throw new AppException({
        code: 'NO_APPLICABLE_RATE_PLAN',
        title: 'Chưa có gói giá áp dụng cho resource/chế độ này',
        status: 422,
      });
    }
    return fallback;
  }
}
