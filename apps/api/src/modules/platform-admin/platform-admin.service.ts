import { Injectable, Logger } from '@nestjs/common';
import {
  type CreatePlatformPlanRequest,
  type PlatformPayment,
  type PlatformPaymentListQuery,
  type PlatformPlan,
  type PlatformTenant,
  type PlatformTenantDetail,
  type PlatformTenantListQuery,
  type UpdatePlatformPlanRequest,
  type UpdatePlatformTenantRequest,
} from '@pms/shared-types';
import { type Prisma } from '@prisma/client';
import { PlanFeatureService } from '@core/billing/plan-feature.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { TenantStatusService } from '@core/tenancy/tenant-status.service';
import { SubscriptionService, sortByTier } from '@modules/subscription/subscription.service';

/**
 * Cấu hình nền tảng cho web-platform: gói thuê bao, danh sách tenant, thanh toán
 * chờ xác nhận. Mọi bảng ở đây (`subscription_plans`, `tenants`,
 * `subscription_payments`, `platform_users`) là GLOBAL — không RLS, truy cập
 * thẳng prisma và KHÔNG withTenant (ADR-0002 §5).
 *
 * Đổi gói/hạn mức có hiệu lực ngay: invalidate cache trạng thái + cờ tính năng
 * của tenant liên quan, không đợi TTL 60s.
 */
@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantStatus: TenantStatusService,
    private readonly planFeatures: PlanFeatureService,
    private readonly subscription: SubscriptionService,
  ) {}

  // ── Gói thuê bao ────────────────────────────────────────────────────────────

  async listPlans(): Promise<PlatformPlan[]> {
    // eslint-disable-next-line no-restricted-syntax -- bảng GLOBAL không RLS (ADR-0002 §5)
    const plans = await this.prisma.subscription_plans.findMany({
      include: { _count: { select: { tenants: true } } },
    });
    return sortByTier(plans).map((p) => ({
      id: p.id,
      code: p.code as PlatformPlan['code'],
      name: p.name,
      max_properties: p.max_properties,
      max_rooms: p.max_rooms,
      max_rooms_per_property: p.max_rooms_per_property,
      max_users: p.max_users,
      monthly_price_vnd: Number(p.monthly_price_vnd),
      features: (p.features ?? {}) as Record<string, unknown>,
      tenant_count: p._count.tenants,
    }));
  }

  async createPlan(dto: CreatePlatformPlanRequest, actor: string): Promise<PlatformPlan> {
    this.assertLimitsCoherent(dto.max_rooms, dto.max_rooms_per_property);
    // eslint-disable-next-line no-restricted-syntax -- bảng GLOBAL không RLS (ADR-0002 §5)
    const existing = await this.prisma.subscription_plans.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new AppException({
        code: 'SUBSCRIPTION_PLAN_EXISTS',
        title: 'Mã gói đã tồn tại',
        status: 409,
        detail: `Gói ${dto.code} đã có — sửa bằng PATCH thay vì tạo mới.`,
      });
    }
    // eslint-disable-next-line no-restricted-syntax -- bảng GLOBAL không RLS (ADR-0002 §5)
    await this.prisma.subscription_plans.create({
      data: {
        code: dto.code,
        name: dto.name,
        max_properties: dto.max_properties,
        max_rooms: dto.max_rooms,
        max_rooms_per_property: dto.max_rooms_per_property,
        max_users: dto.max_users,
        monthly_price_vnd: dto.monthly_price_vnd,
        features: dto.features,
      },
    });
    this.logger.log(`Platform ${actor} tạo gói ${dto.code}`);
    return this.planByCodeOrThrow(dto.code);
  }

  async updatePlan(id: string, dto: UpdatePlatformPlanRequest, actor: string): Promise<PlatformPlan> {
    const plan = await this.planByIdOrThrow(id);
    this.assertLimitsCoherent(
      dto.max_rooms ?? plan.max_rooms,
      dto.max_rooms_per_property ?? plan.max_rooms_per_property,
    );

    const data: Prisma.subscription_plansUpdateInput = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.max_properties !== undefined && { max_properties: dto.max_properties }),
      ...(dto.max_rooms !== undefined && { max_rooms: dto.max_rooms }),
      ...(dto.max_rooms_per_property !== undefined && {
        max_rooms_per_property: dto.max_rooms_per_property,
      }),
      ...(dto.max_users !== undefined && { max_users: dto.max_users }),
      ...(dto.monthly_price_vnd !== undefined && { monthly_price_vnd: dto.monthly_price_vnd }),
      ...(dto.features !== undefined && { features: dto.features }),
      updated_at: new Date(),
    };
    // eslint-disable-next-line no-restricted-syntax -- bảng GLOBAL không RLS (ADR-0002 §5)
    await this.prisma.subscription_plans.update({ where: { id }, data });

    // Tenant đang dùng gói này phải thấy hạn mức/tính năng mới NGAY.
    // eslint-disable-next-line no-restricted-syntax -- bảng GLOBAL không RLS (ADR-0002 §5)
    const affected = await this.prisma.tenants.findMany({
      where: { subscription_plan_id: id },
      select: { id: true },
    });
    await Promise.all(affected.map((t) => this.planFeatures.invalidate(t.id)));

    this.logger.log(`Platform ${actor} sửa gói ${plan.code} (${affected.length} tenant ảnh hưởng)`);
    return this.planByCodeOrThrow(plan.code);
  }

  // ── Tenant ──────────────────────────────────────────────────────────────────

  /**
   * Danh sách tenant KHÔNG kèm usage: properties/rooms/users đều có RLS theo
   * `app.current_tenant_id`, đọc chéo tenant sẽ ra 0 chứ không phải số thật. Đếm
   * đúng đòi một `withTenant` cho mỗi tenant — N transaction cho mỗi lần mở trang.
   * Usage lấy ở `getTenantDetail` khi admin bấm vào một tenant cụ thể.
   */
  async listTenants(query: PlatformTenantListQuery): Promise<{ items: PlatformTenant[]; total: number }> {
    const where: Prisma.tenantsWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.q && {
        OR: [
          { slug: { contains: query.q, mode: 'insensitive' } },
          { display_name: { contains: query.q, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      // eslint-disable-next-line no-restricted-syntax -- bảng GLOBAL không RLS (ADR-0002 §5)
      this.prisma.tenants.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: query.limit,
        skip: query.offset,
        include: { subscription_plans: { select: { code: true } } },
      }),
      // eslint-disable-next-line no-restricted-syntax -- bảng GLOBAL không RLS (ADR-0002 §5)
      this.prisma.tenants.count({ where }),
    ]);

    return { total, items: rows.map((t) => this.toPlatformTenant(t)) };
  }

  /** Một tenant + usage thật (qua withTenant nên RLS pass) — trang chi tiết. */
  async getTenantDetail(id: string): Promise<PlatformTenantDetail> {
    const tenant = await this.tenantOrThrow(id);
    const summary = await this.subscription.getSummary(id);
    return { ...this.toPlatformTenant(tenant), usage: summary.usage, plan: summary.plan };
  }

  async updateTenant(
    id: string,
    dto: UpdatePlatformTenantRequest,
    actor: string,
  ): Promise<PlatformTenant> {
    const tenant = await this.tenantOrThrow(id);
    if (tenant.status === 'CHURNED') {
      throw new AppException({
        code: 'TENANT_CHURNED',
        title: 'Tenant đã đóng',
        status: 422,
        detail: 'Tenant CHURNED không đổi gói/trạng thái được — khôi phục thủ công qua DB nếu cần.',
      });
    }

    const data: Prisma.tenantsUpdateInput = { updated_at: new Date() };
    if (dto.plan_code) {
      const plan = await this.planByCodeOrThrow(dto.plan_code);
      data.subscription_plans = { connect: { id: plan.id } };
    }
    if (dto.status) {
      data.status = dto.status;
      data.suspended_at = dto.status === 'SUSPENDED' ? new Date() : null;
    }
    // eslint-disable-next-line no-restricted-syntax -- bảng GLOBAL không RLS (ADR-0002 §5)
    await this.prisma.tenants.update({ where: { id }, data });

    await Promise.all([this.tenantStatus.invalidate(id), this.planFeatures.invalidate(id)]);
    this.logger.log(`Platform ${actor} sửa tenant ${tenant.slug}: ${JSON.stringify(dto)}`);

    return this.toPlatformTenant(await this.tenantOrThrow(id));
  }

  // ── Thanh toán thuê bao ─────────────────────────────────────────────────────

  async listPayments(query: PlatformPaymentListQuery): Promise<PlatformPayment[]> {
    // eslint-disable-next-line no-restricted-syntax -- bảng GLOBAL không RLS (ADR-0002 §5)
    const rows = await this.prisma.subscription_payments.findMany({
      where: query.status ? { status: query.status } : undefined,
      orderBy: { created_at: 'desc' },
      take: query.limit,
      include: { tenants: { select: { slug: true, display_name: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      plan_code: p.plan_code,
      amount_vnd: Number(p.amount_vnd),
      period_start: p.period_start.toISOString(),
      period_end: p.period_end.toISOString(),
      status: p.status as PlatformPayment['status'],
      payment_ref: p.payment_ref,
      confirmed_at: p.confirmed_at?.toISOString() ?? null,
      created_at: p.created_at.toISOString(),
      tenant_id: p.tenant_id,
      tenant_slug: p.tenants.slug,
      tenant_display_name: p.tenants.display_name,
    }));
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Trần cơ sở lớn hơn trần tổng là vô nghĩa (trần tổng luôn chặn trước) và làm
   * bảng giá nói dối. Chặn ngay khi cấu hình thay vì để lộ ở runtime.
   */
  private assertLimitsCoherent(maxRooms: number, maxRoomsPerProperty: number): void {
    if (maxRoomsPerProperty > maxRooms) {
      throw new AppException({
        code: 'PLAN_LIMITS_INCOHERENT',
        title: 'Hạn mức mâu thuẫn',
        status: 422,
        detail: `Trần phòng mỗi cơ sở (${maxRoomsPerProperty}) không được lớn hơn trần tổng (${maxRooms}).`,
      });
    }
  }

  private toPlatformTenant(
    t: Prisma.tenantsGetPayload<{ include: { subscription_plans: { select: { code: true } } } }>
      | Prisma.tenantsGetPayload<object>,
  ): PlatformTenant {
    const planCode =
      'subscription_plans' in t ? (t.subscription_plans?.code ?? null) : null;
    return {
      id: t.id,
      slug: t.slug,
      display_name: t.display_name,
      status: t.status as PlatformTenant['status'],
      plan_code: planCode as PlatformTenant['plan_code'],
      trial_ends_at: t.trial_ends_at?.toISOString() ?? null,
      current_period_end: t.current_period_end?.toISOString() ?? null,
      created_at: t.created_at.toISOString(),
    };
  }

  private async tenantOrThrow(id: string) {
    // eslint-disable-next-line no-restricted-syntax -- bảng GLOBAL không RLS (ADR-0002 §5)
    const tenant = await this.prisma.tenants.findUnique({
      where: { id },
      include: { subscription_plans: { select: { code: true } } },
    });
    if (!tenant) {
      throw new AppException({ code: 'TENANT_NOT_FOUND', title: 'Không tìm thấy tenant', status: 404 });
    }
    return tenant;
  }

  private async planByIdOrThrow(id: string) {
    // eslint-disable-next-line no-restricted-syntax -- bảng GLOBAL không RLS (ADR-0002 §5)
    const plan = await this.prisma.subscription_plans.findUnique({ where: { id } });
    if (!plan) {
      throw new AppException({
        code: 'SUBSCRIPTION_PLAN_NOT_FOUND',
        title: 'Không tìm thấy gói',
        status: 404,
      });
    }
    return plan;
  }

  private async planByCodeOrThrow(code: string): Promise<PlatformPlan> {
    const plan = (await this.listPlans()).find((p) => p.code === code);
    if (!plan) {
      throw new AppException({
        code: 'SUBSCRIPTION_PLAN_NOT_FOUND',
        title: 'Không tìm thấy gói',
        status: 404,
      });
    }
    return plan;
  }
}
