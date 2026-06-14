import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type ChargeSubscriptionResponse,
  type JwtClaims,
  type SubscriptionPaymentResponse,
  type SubscriptionPlan,
  type SubscriptionPlanCode,
  type SubscriptionSummaryResponse,
} from '@pms/shared-types';
import { type Prisma, type subscription_payments, type subscription_plans } from '@prisma/client';
import { ENV, type Env } from '@core/config/env.schema';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { TenantStatusService } from '@core/tenancy/tenant-status.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { VietqrService } from '@modules/payments/vietqr.service';

/** Cộng n tháng theo lịch (giữ ngày, tự kẹp cuối tháng theo JS Date). */
function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}

type ResourceKind = 'property' | 'room' | 'user';
const MAX_FIELD: Record<ResourceKind, 'max_properties' | 'max_rooms' | 'max_users'> = {
  property: 'max_properties',
  room: 'max_rooms',
  user: 'max_users',
};

function toPlan(p: subscription_plans): SubscriptionPlan {
  return {
    id: p.id,
    code: p.code as SubscriptionPlanCode,
    max_properties: p.max_properties,
    max_rooms: p.max_rooms,
    max_users: p.max_users,
    monthly_price_vnd: Number(p.monthly_price_vnd),
    features: (p.features ?? {}) as Record<string, unknown>,
  };
}

function toPaymentResponse(p: subscription_payments): SubscriptionPaymentResponse {
  return {
    id: p.id,
    plan_code: p.plan_code,
    amount_vnd: Number(p.amount_vnd),
    period_start: p.period_start.toISOString(),
    period_end: p.period_end.toISOString(),
    status: p.status as SubscriptionPaymentResponse['status'],
    payment_ref: p.payment_ref,
    confirmed_at: p.confirmed_at ? p.confirmed_at.toISOString() : null,
    created_at: p.created_at.toISOString(),
  };
}

/**
 * Billing-lite SaaS (task 4.7, docs/02 §6). Vòng đời thuê bao + plan-limit guard +
 * thu phí VietQR (tái dùng VietqrService 3.3) + platform admin xác nhận. Bảng
 * `subscription_payments`/`tenants` GLOBAL (không RLS) → truy cập trực tiếp prisma,
 * lọc tenant_id TƯỜNG MINH (tenant-facing) hoặc cross-tenant (platform/cron).
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vietqr: VietqrService,
    private readonly tenantStatus: TenantStatusService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ── Trang billing: gói + trạng thái + usage ────────────────────────────────
  async getSummary(user: JwtClaims): Promise<SubscriptionSummaryResponse> {
    const tenant = await this.loadTenant(user.tnt);
    const usage = await withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const [properties, rooms, users] = await Promise.all([
          tx.properties.count(),
          tx.rooms.count(),
          tx.users.count(),
        ]);
        return { properties, rooms, users };
      },
      { readOnly: true },
    );
    return {
      status: tenant.status as SubscriptionSummaryResponse['status'],
      trial_ends_at: tenant.trial_ends_at ? tenant.trial_ends_at.toISOString() : null,
      current_period_end: tenant.current_period_end
        ? tenant.current_period_end.toISOString()
        : null,
      plan: tenant.subscription_plans ? toPlan(tenant.subscription_plans) : null,
      usage,
    };
  }

  // ── Plan-limit guard (gọi TRONG tx tạo property/room/user) ──────────────────
  async assertWithinPlanLimitTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    resource: ResourceKind,
  ): Promise<void> {
    // tenants/subscription_plans GLOBAL — đọc được trong tx (không RLS).
    const tenant = await tx.tenants.findUnique({
      where: { id: tenantId },
      include: { subscription_plans: true },
    });
    const plan = tenant?.subscription_plans;
    if (!plan) return; // chưa gán gói → không áp giới hạn (an toàn)

    const max = plan[MAX_FIELD[resource]];
    const count =
      resource === 'property'
        ? await tx.properties.count()
        : resource === 'room'
          ? await tx.rooms.count()
          : await tx.users.count();

    if (count >= max) {
      throw new AppException({
        code: 'PLAN_LIMIT_REACHED',
        title: 'Đã đạt giới hạn gói thuê bao',
        status: 422,
        detail: `Gói ${plan.code} cho phép tối đa ${max} ${resource}. Nâng gói để thêm (POST /billing/charge).`,
      });
    }
  }

  // ── Lịch sử thanh toán của tenant ───────────────────────────────────────────
  async listPayments(user: JwtClaims): Promise<SubscriptionPaymentResponse[]> {
    // eslint-disable-next-line no-restricted-syntax -- bảng GLOBAL không RLS; lọc tenant_id tường minh (task 4.7)
    const rows = await this.prisma.subscription_payments.findMany({
      where: { tenant_id: user.tnt },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
    return rows.map(toPaymentResponse);
  }

  // ── Thu phí: tạo payment PENDING + VietQR động ──────────────────────────────
  async charge(user: JwtClaims, planCode?: SubscriptionPlanCode): Promise<ChargeSubscriptionResponse> {
    const tenant = await this.loadTenant(user.tnt);
    const plan = await this.resolvePlan(planCode, tenant.subscription_plans);
    if (plan.monthly_price_vnd <= 0) {
      throw new AppException({
        code: 'PLAN_NOT_CHARGEABLE',
        title: 'Gói không có phí để thu',
        status: 422,
        detail: `Gói ${plan.code} miễn phí — không cần thanh toán.`,
      });
    }

    const now = new Date();
    const periodStart = now;
    const periodEnd = addMonths(now, 1);
    const paymentRef = `SUB-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

    // eslint-disable-next-line no-restricted-syntax -- bảng GLOBAL không RLS; tenant_id gắn tường minh (task 4.7)
    const payment = await this.prisma.subscription_payments.create({
      data: {
        tenant_id: user.tnt,
        plan_id: plan.id,
        plan_code: plan.code,
        amount_vnd: plan.monthly_price_vnd,
        period_start: periodStart,
        period_end: periodEnd,
        payment_ref: paymentRef,
      },
    });

    const qrPayload = this.vietqr.buildPayload({
      bankBin: this.env.PLATFORM_BANK_BIN,
      accountNumber: this.env.PLATFORM_BANK_ACCOUNT,
      amount: plan.monthly_price_vnd,
      addInfo: paymentRef,
    });

    return {
      payment: toPaymentResponse(payment),
      qr: {
        payload: qrPayload,
        amount_vnd: plan.monthly_price_vnd,
        bank_bin: this.env.PLATFORM_BANK_BIN,
        account_number: this.env.PLATFORM_BANK_ACCOUNT,
        add_info: paymentRef,
      },
    };
  }

  // ── Platform admin xác nhận thanh toán → tenant ACTIVE + gia hạn ─────────────
  async confirmPayment(paymentId: string): Promise<SubscriptionPaymentResponse> {
    // eslint-disable-next-line no-restricted-syntax -- platform cross-tenant, bảng non-RLS (task 4.7)
    const payment = await this.prisma.subscription_payments.findUnique({ where: { id: paymentId } });
    if (!payment) {
      throw new AppException({ code: 'SUBSCRIPTION_PAYMENT_NOT_FOUND', title: 'Không tìm thấy thanh toán', status: 404 });
    }
    if (payment.status === 'CONFIRMED') return toPaymentResponse(payment); // idempotent
    if (payment.status === 'CANCELLED') {
      throw new AppException({ code: 'SUBSCRIPTION_PAYMENT_CANCELLED', title: 'Thanh toán đã huỷ', status: 422 });
    }

    const now = new Date();
    // $transaction (không withTenant): tenants/subscription_payments GLOBAL không RLS;
    // truy cập qua `tx.*` (không phải this.prisma.*) nên ngoài phạm vi rule tenancy.
    const updated = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenants.findUnique({ where: { id: payment.tenant_id } });
      const base = tenant?.current_period_end && tenant.current_period_end > now ? tenant.current_period_end : now;
      const newPeriodEnd = addMonths(base, 1);
      await tx.tenants.update({
        where: { id: payment.tenant_id },
        data: {
          status: 'ACTIVE',
          subscription_plan_id: payment.plan_id,
          current_period_end: newPeriodEnd,
          suspended_at: null,
        },
      });
      return tx.subscription_payments.update({
        where: { id: paymentId },
        data: { status: 'CONFIRMED', confirmed_at: now, period_end: newPeriodEnd },
      });
    });

    await this.tenantStatus.invalidate(payment.tenant_id); // bỏ chặn write NGAY
    this.logger.log(`Subscription confirmed: tenant=${payment.tenant_id} plan=${payment.plan_code} ref=${payment.payment_ref}`);
    return toPaymentResponse(updated);
  }

  // ── Cron lifecycle (night-audit gọi) — cross-tenant trên bảng tenants ────────
  async runLifecycleSweep(now: Date): Promise<{ suspended: number; churned: number }> {
    const churnCutoff = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // TRIAL hết hạn dùng thử → SUSPENDED
    // eslint-disable-next-line no-restricted-syntax -- platform cross-tenant, bảng non-RLS (ADR-0002 §5)
    const trialExpired = await this.prisma.tenants.updateMany({
      where: { status: 'TRIAL', trial_ends_at: { lt: now } },
      data: { status: 'SUSPENDED', suspended_at: now },
    });
    // ACTIVE hết hạn thuê bao → SUSPENDED
    // eslint-disable-next-line no-restricted-syntax -- platform cross-tenant, bảng non-RLS (ADR-0002 §5)
    const lapsed = await this.prisma.tenants.updateMany({
      where: { status: 'ACTIVE', current_period_end: { lt: now } },
      data: { status: 'SUSPENDED', suspended_at: now },
    });
    // SUSPENDED quá 60 ngày → CHURNED
    // eslint-disable-next-line no-restricted-syntax -- platform cross-tenant, bảng non-RLS (ADR-0002 §5)
    const churned = await this.prisma.tenants.updateMany({
      where: { status: 'SUSPENDED', suspended_at: { lt: churnCutoff } },
      data: { status: 'CHURNED' },
    });

    const suspended = trialExpired.count + lapsed.count;
    if (suspended > 0 || churned.count > 0) {
      this.logger.log(`Subscription lifecycle: suspended=${suspended} churned=${churned.count}`);
    }
    return { suspended, churned: churned.count };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  private async loadTenant(tenantId: string): Promise<
    Prisma.tenantsGetPayload<{ include: { subscription_plans: true } }>
  > {
    // eslint-disable-next-line no-restricted-syntax -- bảng tenants GLOBAL không RLS (ADR-0002 §5)
    const tenant = await this.prisma.tenants.findUnique({
      where: { id: tenantId },
      include: { subscription_plans: true },
    });
    if (!tenant) {
      throw new AppException({ code: 'TENANT_NOT_FOUND', title: 'Không tìm thấy tenant', status: 404 });
    }
    return tenant;
  }

  /** Gói muốn trả: theo code (nâng gói) hoặc gói hiện tại. */
  private async resolvePlan(
    planCode: SubscriptionPlanCode | undefined,
    currentPlan: subscription_plans | null,
  ): Promise<SubscriptionPlan> {
    if (planCode) {
      // eslint-disable-next-line no-restricted-syntax -- bảng subscription_plans GLOBAL không RLS
      const plan = await this.prisma.subscription_plans.findUnique({ where: { code: planCode } });
      if (!plan) {
        throw new AppException({ code: 'SUBSCRIPTION_PLAN_NOT_FOUND', title: 'Không tìm thấy gói', status: 404 });
      }
      return toPlan(plan);
    }
    if (!currentPlan) {
      throw new AppException({
        code: 'SUBSCRIPTION_PLAN_REQUIRED',
        title: 'Chưa có gói để thu phí',
        status: 422,
        detail: 'Truyền plan_code để chọn gói cần thanh toán.',
      });
    }
    return toPlan(currentPlan);
  }
}
