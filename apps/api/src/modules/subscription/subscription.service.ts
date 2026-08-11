import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
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
import { Queue } from 'bullmq';
import { PlanFeatureService } from '@core/billing/plan-feature.service';
import { QUEUE_BILLING_GATEWAY } from '@core/bullmq/queues';
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

/**
 * jobId cổng mock — tiền tố `mock-gw__` + payment.id. Dùng `__` (KHÔNG `:`) vì
 * BullMQ vỡ với jobId chứa `:` (gotcha memory + reconciliation.service). Đồng thời
 * dedup: enqueue nhiều lần cùng payment → BullMQ giữ 1 job theo jobId.
 */
export function mockGatewayJobId(paymentId: string): string {
  return `mock-gw__${paymentId}`;
}

/** Payload delayed job cổng mock. */
export interface MockGatewayJobData {
  paymentId: string;
}

type ResourceKind = 'property' | 'room' | 'user';
const MAX_FIELD: Record<ResourceKind, 'max_properties' | 'max_rooms' | 'max_users'> = {
  property: 'max_properties',
  room: 'max_rooms',
  user: 'max_users',
};
/** Tên tiếng Việt của tài nguyên — dùng trong thông báo chạm trần. */
const RESOURCE_LABEL: Record<ResourceKind, string> = {
  property: 'cơ sở',
  room: 'phòng',
  user: 'người dùng',
};
/**
 * Hạn mức đếm bản ghi CÒN SỐNG. properties/rooms/users đều soft-delete
 * (`deleted_at`) — không lọc thì cơ sở/phòng đã xoá vẫn ăn quota và khách không
 * tạo lại được, rất dễ chạm với trần nhỏ của gói FREE.
 */
const ALIVE = { deleted_at: null } as const;

function toPlan(p: subscription_plans): SubscriptionPlan {
  return {
    id: p.id,
    code: p.code as SubscriptionPlanCode,
    max_properties: p.max_properties,
    max_rooms: p.max_rooms,
    max_rooms_per_property: p.max_rooms_per_property,
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
    private readonly planFeatures: PlanFeatureService,
    @Inject(ENV) private readonly env: Env,
    @InjectQueue(QUEUE_BILLING_GATEWAY) private readonly gatewayQueue: Queue,
  ) {}

  // ── Trang billing: gói + trạng thái + usage ────────────────────────────────
  async getSummary(user: JwtClaims): Promise<SubscriptionSummaryResponse> {
    const tenant = await this.loadTenant(user.tnt);
    const usage = await withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const [properties, rooms, users, byProperty] = await Promise.all([
          tx.properties.count({ where: ALIVE }),
          tx.rooms.count({ where: ALIVE }),
          tx.users.count({ where: ALIVE }),
          // Trần theo từng cơ sở (max_rooms_per_property) → cần số phòng của mỗi cơ sở,
          // kể cả cơ sở 0 phòng (groupBy trên rooms bỏ sót) → đi từ properties.
          tx.properties.findMany({
            where: ALIVE,
            select: { id: true, name: true, _count: { select: { rooms: { where: ALIVE } } } },
            orderBy: { name: 'asc' },
          }),
        ]);
        return {
          properties,
          rooms,
          users,
          rooms_by_property: byProperty.map((p) => ({
            property_id: p.id,
            property_name: p.name,
            rooms: p._count.rooms,
          })),
        };
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
    const plan = await this.loadPlanTx(tx, tenantId);
    if (!plan) return; // chưa gán gói → không áp giới hạn (an toàn)

    const count =
      resource === 'property'
        ? await tx.properties.count({ where: ALIVE })
        : resource === 'room'
          ? await tx.rooms.count({ where: ALIVE })
          : await tx.users.count({ where: ALIVE });

    this.assertUnderCap(count, plan[MAX_FIELD[resource]], plan.code, RESOURCE_LABEL[resource]);
  }

  /**
   * Guard riêng cho phòng: gói có HAI trần độc lập — `max_rooms` (tổng toàn
   * tenant) và `max_rooms_per_property` (từng cơ sở). Chạm trần nào báo trần đó,
   * vì cách xử lý khác nhau: chạm trần cơ sở thì mở cơ sở mới cũng được, chạm
   * trần tổng thì buộc phải nâng gói.
   */
  async assertRoomWithinPlanTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    propertyId: string,
  ): Promise<void> {
    const plan = await this.loadPlanTx(tx, tenantId);
    if (!plan) return;

    const [total, inProperty] = await Promise.all([
      tx.rooms.count({ where: ALIVE }),
      tx.rooms.count({ where: { ...ALIVE, property_id: propertyId } }),
    ]);

    this.assertUnderCap(inProperty, plan.max_rooms_per_property, plan.code, 'phòng mỗi cơ sở');
    this.assertUnderCap(total, plan.max_rooms, plan.code, 'phòng');
  }

  private assertUnderCap(count: number, max: number, planCode: string, label: string): void {
    if (count < max) return;
    throw new AppException({
      code: 'PLAN_LIMIT_REACHED',
      title: 'Đã đạt giới hạn gói thuê bao',
      status: 422,
      detail: `Gói ${planCode} cho phép tối đa ${max} ${label}. Nâng gói để thêm (POST /billing/charge).`,
    });
  }

  /** tenants/subscription_plans GLOBAL — đọc được trong tx (không RLS). */
  private async loadPlanTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<subscription_plans | null> {
    const tenant = await tx.tenants.findUnique({
      where: { id: tenantId },
      include: { subscription_plans: true },
    });
    return tenant?.subscription_plans ?? null;
  }

  // ── Danh sách gói (task 6.7 S3 — chọn gói để nâng cấp) ──────────────────────
  async listPlans(): Promise<SubscriptionPlan[]> {
    // eslint-disable-next-line no-restricted-syntax -- subscription_plans GLOBAL không RLS (ADR-0002 §5)
    const plans = await this.prisma.subscription_plans.findMany({
      orderBy: { monthly_price_vnd: 'asc' },
    });
    return plans.map(toPlan);
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

    // Đợt 4/M2: CHỈ mode 'mock' mới enqueue delayed auto-confirm. Mode 'manual'
    // (mặc định) KHÔNG chạm queue → luồng prod y hệt trước (admin xác nhận tay).
    if (this.env.BILLING_GATEWAY === 'mock') {
      await this.enqueueMockGatewayConfirm(payment.id);
    }

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

    // Bỏ chặn write NGAY + mở tính năng của gói mới NGAY (không chờ TTL 60s)
    await Promise.all([
      this.tenantStatus.invalidate(payment.tenant_id),
      this.planFeatures.invalidate(payment.tenant_id),
    ]);
    this.logger.log(`Subscription confirmed: tenant=${payment.tenant_id} plan=${payment.plan_code} ref=${payment.payment_ref}`);
    return toPaymentResponse(updated);
  }

  // ── Resolver ref → id (endpoint mock-gateway public dùng payment_ref, không id) ─
  /**
   * Xác nhận theo `payment_ref` (cột `@unique`) rồi delegate `confirmPayment(id)`.
   * Dùng cho cổng mock (endpoint public + delayed job) — cổng thật đối chiếu theo
   * mã giao dịch/nội dung chuyển khoản = payment_ref, không biết id nội bộ. 404
   * SUBSCRIPTION_PAYMENT_NOT_FOUND nếu ref không tồn tại; CANCELLED/CONFIRMED thừa
   * kế nguyên trạng từ confirmPayment (idempotent / 422).
   */
  async confirmPaymentByRef(paymentRef: string): Promise<SubscriptionPaymentResponse> {
    // eslint-disable-next-line no-restricted-syntax -- bảng subscription_payments GLOBAL không RLS; ref là @unique (M2)
    const payment = await this.prisma.subscription_payments.findUnique({
      where: { payment_ref: paymentRef },
      select: { id: true },
    });
    if (!payment) {
      throw new AppException({
        code: 'SUBSCRIPTION_PAYMENT_NOT_FOUND',
        title: 'Không tìm thấy thanh toán',
        status: 404,
      });
    }
    return this.confirmPayment(payment.id);
  }

  // ── Enqueue delayed auto-confirm cổng mock (dedup theo jobId) ────────────────
  /**
   * Thêm 1 delayed job vào queue `billing-gateway` để tự confirm payment sau
   * MOCK_GATEWAY_AUTOCONFIRM_SECONDS giây. jobId cố định theo payment → BullMQ dedup
   * (enqueue 2 lần cùng payment chỉ giữ 1 job). Chỉ gọi ở mode 'mock'.
   */
  async enqueueMockGatewayConfirm(paymentId: string): Promise<void> {
    await this.gatewayQueue.add(
      'mock-gateway-confirm',
      { paymentId } satisfies MockGatewayJobData,
      {
        jobId: mockGatewayJobId(paymentId),
        delay: this.env.MOCK_GATEWAY_AUTOCONFIRM_SECONDS * 1000,
      },
    );
  }

  // ── Cron lifecycle (night-audit gọi) — cross-tenant trên bảng tenants ────────
  async runLifecycleSweep(
    now: Date,
  ): Promise<{ downgraded: number; suspended: number; churned: number }> {
    const churnCutoff = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // TRIAL hết hạn → HẠ VỀ FREE, KHÔNG khoá. Dùng thử 14 ngày chạy ở mức STARTER
    // (auth.service.register); hết hạn thì tài khoản vẫn dùng được ở hạn mức FREE.
    // Dữ liệu giữ nguyên — vượt trần chỉ chặn TẠO MỚI, không xoá gì.
    // eslint-disable-next-line no-restricted-syntax -- bảng subscription_plans GLOBAL không RLS
    const freePlan = await this.prisma.subscription_plans.findUnique({ where: { code: 'FREE' } });
    // eslint-disable-next-line no-restricted-syntax -- platform cross-tenant, bảng non-RLS (ADR-0002 §5)
    const trialExpired = await this.prisma.tenants.updateMany({
      where: { status: 'TRIAL', trial_ends_at: { lt: now } },
      // current_period_end để NULL: nhánh "ACTIVE hết hạn" dưới đây so `lt: now`
      // nên NULL không lọt → tenant FREE không bị treo ở vòng cron kế tiếp.
      data: {
        status: 'ACTIVE',
        trial_ends_at: null,
        ...(freePlan ? { subscription_plan_id: freePlan.id } : {}),
      },
    });
    // ACTIVE hết hạn thuê bao ĐÃ TRẢ TIỀN → SUSPENDED (khác chuyện hết trial)
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

    if (trialExpired.count > 0 || lapsed.count > 0 || churned.count > 0) {
      this.logger.log(
        `Subscription lifecycle: downgraded=${trialExpired.count} suspended=${lapsed.count} churned=${churned.count}`,
      );
    }
    if (trialExpired.count > 0 && !freePlan) {
      this.logger.warn('Không tìm thấy gói FREE — tenant hết trial giữ nguyên gói cũ. Chạy pnpm db:seed:required.');
    }
    return { downgraded: trialExpired.count, suspended: lapsed.count, churned: churned.count };
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
