import { Injectable } from '@nestjs/common';
import {
  type AssignRatePlanResourcesRequest,
  type CreateRatePlanRequest,
  type CreateRatePlanRuleRequest,
  type JwtClaims,
  type RatePlanResponse,
  type RatePlanRuleResponse,
  type UpdateRatePlanRequest,
  type UpdateRatePlanRuleRequest,
} from '@pms/shared-types';
import { Prisma, type rate_plans } from '@prisma/client';
import { PermissionService } from '@core/auth/permission.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { toRatePlanResponse, toRuleResponse, timeToDate, ymdToDate } from './rate-plan.mappers';

type Tx = Prisma.TransactionClient;

/** Field giá — đổi bất kỳ field nào → bump version (docs/07 §6). */
const PRICING_KEYS = [
  'base_price_vnd',
  'deposit_type',
  'deposit_value',
  'hourly_base_hours',
  'hourly_extra_block_minutes',
  'hourly_extra_block_price_vnd',
  'hourly_overnight_surcharge_vnd',
  'hourly_overnight_start',
  'hourly_overnight_end',
  'daily_checkin_time',
  'daily_checkout_time',
  'daily_early_checkin_fee_vnd',
  'daily_late_checkout_fee_vnd',
  'monthly_includes_utilities',
  'monthly_electricity_per_kwh_vnd',
  'monthly_water_per_m3_vnd',
] as const;

const bigOrU = (v: number | null | undefined): bigint | undefined =>
  v == null ? undefined : BigInt(v);

/** Field giá plain (loại base_price — set riêng vì create yêu cầu, update optional).
 *  Gán được cho cả UncheckedCreateInput lẫn UncheckedUpdateInput. */
interface PricingWriteData {
  deposit_type?: string;
  deposit_value?: bigint;
  hourly_base_hours?: number;
  hourly_extra_block_minutes?: number;
  hourly_extra_block_price_vnd?: bigint;
  hourly_overnight_surcharge_vnd?: bigint;
  hourly_overnight_start?: Date;
  hourly_overnight_end?: Date;
  daily_checkin_time?: Date;
  daily_checkout_time?: Date;
  daily_early_checkin_fee_vnd?: bigint;
  daily_late_checkout_fee_vnd?: bigint;
  monthly_includes_utilities?: boolean;
  monthly_electricity_per_kwh_vnd?: bigint;
  monthly_water_per_m3_vnd?: bigint;
}

/** Hai khoảng ngày giao nhau (null = vô cực một phía). */
function rangeOverlaps(
  aStart: Date | null,
  aEnd: Date | null,
  bStart: Date | null,
  bEnd: Date | null,
): boolean {
  if (aEnd && bStart && aEnd.getTime() < bStart.getTime()) return false;
  if (bEnd && aStart && bEnd.getTime() < aStart.getTime()) return false;
  return true;
}

/** Tập thứ-trong-tuần giao nhau (rỗng = áp mọi ngày). */
function daysOverlap(a: number[], b: number[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  const set = new Set(a);
  return b.some((d) => set.has(d));
}

interface RuleWindow {
  priority: number;
  start: Date | null;
  end: Date | null;
  days: number[];
}

@Injectable()
export class RatePlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
  ) {}

  // ── Rate plans ───────────────────────────────────────────────────────────

  async create(dto: CreateRatePlanRequest, user: JwtClaims): Promise<RatePlanResponse> {
    await this.assertPropertyExists(dto.property_id, user);
    await this.permissionService.authorizeOnProperty(user, dto.property_id, 'rate_plan.manage');
    const resourceIds = dto.resource_ids ? [...new Set(dto.resource_ids)] : [];

    return withTenant(this.prisma, user.tnt, async (tx) => {
      // first plan cho (property, mode) → ép default; hoặc client yêu cầu is_default
      const existing = await tx.rate_plans.count({
        where: { property_id: dto.property_id, mode: dto.mode },
      });
      const makeDefault = dto.is_default === true || existing === 0;
      if (makeDefault) await this.clearDefault(tx, dto.property_id, dto.mode);

      const plan = await tx.rate_plans.create({
        data: {
          tenant_id: user.tnt,
          property_id: dto.property_id,
          name: dto.name,
          mode: dto.mode,
          is_default: makeDefault,
          base_price_vnd: BigInt(dto.base_price_vnd),
          effective_from: ymdToDate(dto.effective_from),
          effective_to: dto.effective_to ? ymdToDate(dto.effective_to) : undefined,
          ...this.pricingWriteData(dto),
        },
      });

      if (resourceIds.length) {
        await this.assertResourcesInProperty(tx, dto.property_id, resourceIds);
        await tx.rate_plan_resources.createMany({
          data: resourceIds.map((resource_id) => ({
            tenant_id: user.tnt,
            rate_plan_id: plan.id,
            resource_id,
          })),
        });
      }
      return toRatePlanResponse(plan, resourceIds);
    });
  }

  async list(
    propertyId: string,
    user: JwtClaims,
    mode?: string,
  ): Promise<RatePlanResponse[]> {
    await this.assertPropertyExists(propertyId, user);
    await this.permissionService.authorizeOnProperty(user, propertyId, 'property.read');

    return withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const plans = await tx.rate_plans.findMany({
          where: { property_id: propertyId, ...(mode ? { mode: mode as never } : {}) },
          orderBy: [{ mode: 'asc' }, { created_at: 'asc' }],
        });
        const links = await tx.rate_plan_resources.findMany({
          where: { rate_plan_id: { in: plans.map((p) => p.id) } },
        });
        const byPlan = new Map<string, string[]>();
        for (const l of links) {
          const arr = byPlan.get(l.rate_plan_id) ?? [];
          arr.push(l.resource_id);
          byPlan.set(l.rate_plan_id, arr);
        }
        return plans.map((p) => toRatePlanResponse(p, byPlan.get(p.id) ?? []));
      },
      { readOnly: true },
    );
  }

  async getById(id: string, user: JwtClaims): Promise<RatePlanResponse> {
    const plan = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, plan.property_id, 'property.read');
    return withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const [links, rules] = await Promise.all([
          tx.rate_plan_resources.findMany({ where: { rate_plan_id: id } }),
          tx.rate_plan_rules.findMany({
            where: { rate_plan_id: id },
            orderBy: [{ priority: 'desc' }, { created_at: 'asc' }],
          }),
        ]);
        return toRatePlanResponse(
          plan,
          links.map((l) => l.resource_id),
          rules,
        );
      },
      { readOnly: true },
    );
  }

  async update(
    id: string,
    dto: UpdateRatePlanRequest,
    user: JwtClaims,
  ): Promise<RatePlanResponse> {
    const plan = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, plan.property_id, 'rate_plan.manage');
    this.assertEffectiveWindow(dto, plan);

    if (dto.is_default === false && plan.is_default) {
      throw new AppException({
        code: 'RATE_PLAN_DEFAULT_REQUIRED',
        title: 'Không thể bỏ mặc định — hãy đặt gói khác làm mặc định thay thế',
        status: 422,
      });
    }
    const pricingChanged = PRICING_KEYS.some((k) => dto[k] !== undefined);

    return withTenant(this.prisma, user.tnt, async (tx) => {
      if (dto.is_default === true && !plan.is_default) {
        await this.clearDefault(tx, plan.property_id, plan.mode);
      }
      const updated = await tx.rate_plans.update({
        where: { id },
        data: {
          name: dto.name,
          is_default: dto.is_default,
          is_active: dto.is_active,
          base_price_vnd: bigOrU(dto.base_price_vnd),
          effective_from: dto.effective_from ? ymdToDate(dto.effective_from) : undefined,
          effective_to:
            dto.effective_to === undefined
              ? undefined
              : dto.effective_to === null
                ? null
                : ymdToDate(dto.effective_to),
          ...this.pricingWriteData(dto),
          ...(pricingChanged ? { version: { increment: 1 } } : {}),
        },
      });
      const links = await tx.rate_plan_resources.findMany({ where: { rate_plan_id: id } });
      return toRatePlanResponse(updated, links.map((l) => l.resource_id));
    });
  }

  async remove(id: string, user: JwtClaims): Promise<void> {
    const plan = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, plan.property_id, 'rate_plan.manage');
    await withTenant(this.prisma, user.tnt, async (tx) => {
      if (plan.is_default) {
        const others = await tx.rate_plans.count({
          where: { property_id: plan.property_id, mode: plan.mode, id: { not: id } },
        });
        if (others > 0) {
          throw new AppException({
            code: 'RATE_PLAN_DEFAULT_REQUIRED',
            title: 'Gói mặc định — đặt gói khác làm mặc định trước khi xoá',
            status: 422,
          });
        }
      }
      // rate_plan_rules/resources cascade; FK bookings (2.6) chặn nếu đã dùng → 409
      await tx.rate_plans.delete({ where: { id } });
    });
  }

  /** Gán danh sách resource cho plan (thay thế toàn bộ; rỗng = gỡ hết). */
  async assignResources(
    id: string,
    dto: AssignRatePlanResourcesRequest,
    user: JwtClaims,
  ): Promise<RatePlanResponse> {
    const plan = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, plan.property_id, 'rate_plan.manage');
    const resourceIds = [...new Set(dto.resource_ids)];

    return withTenant(this.prisma, user.tnt, async (tx) => {
      if (resourceIds.length) await this.assertResourcesInProperty(tx, plan.property_id, resourceIds);
      await tx.rate_plan_resources.deleteMany({ where: { rate_plan_id: id } });
      if (resourceIds.length) {
        await tx.rate_plan_resources.createMany({
          data: resourceIds.map((resource_id) => ({
            tenant_id: user.tnt,
            rate_plan_id: id,
            resource_id,
          })),
        });
      }
      return toRatePlanResponse(plan, resourceIds);
    });
  }

  // ── Rules ──────────────────────────────────────────────────────────────────

  async listRules(planId: string, user: JwtClaims): Promise<RatePlanRuleResponse[]> {
    const plan = await this.loadOrThrow(planId, user);
    await this.permissionService.authorizeOnProperty(user, plan.property_id, 'property.read');
    const rules = await withTenant(
      this.prisma,
      user.tnt,
      (tx) =>
        tx.rate_plan_rules.findMany({
          where: { rate_plan_id: planId },
          orderBy: [{ priority: 'desc' }, { created_at: 'asc' }],
        }),
      { readOnly: true },
    );
    return rules.map(toRuleResponse);
  }

  async createRule(
    planId: string,
    dto: CreateRatePlanRuleRequest,
    user: JwtClaims,
  ): Promise<RatePlanRuleResponse> {
    const plan = await this.loadOrThrow(planId, user);
    await this.permissionService.authorizeOnProperty(user, plan.property_id, 'rate_plan.manage');
    const candidate: RuleWindow = {
      priority: dto.priority ?? 0,
      start: dto.start_date ? ymdToDate(dto.start_date) : null,
      end: dto.end_date ? ymdToDate(dto.end_date) : null,
      days: dto.days_of_week ?? [],
    };

    return withTenant(this.prisma, user.tnt, async (tx) => {
      await this.assertNoRuleConflict(tx, planId, candidate);
      const rule = await tx.rate_plan_rules.create({
        data: {
          tenant_id: user.tnt,
          rate_plan_id: planId,
          rule_type: dto.rule_type,
          start_date: dto.start_date ? ymdToDate(dto.start_date) : undefined,
          end_date: dto.end_date ? ymdToDate(dto.end_date) : undefined,
          days_of_week: dto.days_of_week ?? [],
          price_modifier_type: dto.price_modifier_type,
          price_modifier_value: BigInt(dto.price_modifier_value),
          priority: dto.priority,
          notes: dto.notes,
        },
      });
      await this.bumpVersion(tx, planId); // rule đổi giá → bump version
      return toRuleResponse(rule);
    });
  }

  async updateRule(
    planId: string,
    ruleId: string,
    dto: UpdateRatePlanRuleRequest,
    user: JwtClaims,
  ): Promise<RatePlanRuleResponse> {
    const plan = await this.loadOrThrow(planId, user);
    await this.permissionService.authorizeOnProperty(user, plan.property_id, 'rate_plan.manage');

    return withTenant(this.prisma, user.tnt, async (tx) => {
      const existing = await tx.rate_plan_rules.findFirst({
        where: { id: ruleId, rate_plan_id: planId },
      });
      if (!existing) {
        throw new AppException({ code: 'RULE_NOT_FOUND', title: 'Rule không tồn tại', status: 404 });
      }
      const candidate: RuleWindow = {
        priority: dto.priority ?? existing.priority,
        start: this.mergeDate(dto.start_date, existing.start_date),
        end: this.mergeDate(dto.end_date, existing.end_date),
        days: dto.days_of_week === undefined ? existing.days_of_week : (dto.days_of_week ?? []),
      };
      await this.assertNoRuleConflict(tx, planId, candidate, ruleId);

      const rule = await tx.rate_plan_rules.update({
        where: { id: ruleId },
        data: {
          rule_type: dto.rule_type,
          start_date: this.dateUpdate(dto.start_date),
          end_date: this.dateUpdate(dto.end_date),
          days_of_week: dto.days_of_week === undefined ? undefined : { set: dto.days_of_week ?? [] },
          price_modifier_type: dto.price_modifier_type,
          price_modifier_value:
            dto.price_modifier_value == null ? undefined : BigInt(dto.price_modifier_value),
          priority: dto.priority,
          notes: dto.notes === undefined ? undefined : dto.notes,
        },
      });
      await this.bumpVersion(tx, planId);
      return toRuleResponse(rule);
    });
  }

  async removeRule(planId: string, ruleId: string, user: JwtClaims): Promise<void> {
    const plan = await this.loadOrThrow(planId, user);
    await this.permissionService.authorizeOnProperty(user, plan.property_id, 'rate_plan.manage');
    await withTenant(this.prisma, user.tnt, async (tx) => {
      const result = await tx.rate_plan_rules.deleteMany({
        where: { id: ruleId, rate_plan_id: planId },
      });
      if (result.count === 0) {
        throw new AppException({ code: 'RULE_NOT_FOUND', title: 'Rule không tồn tại', status: 404 });
      }
      await this.bumpVersion(tx, planId);
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async clearDefault(tx: Tx, propertyId: string, mode: rate_plans['mode']): Promise<void> {
    await tx.rate_plans.updateMany({
      where: { property_id: propertyId, mode, is_default: true },
      data: { is_default: false },
    });
  }

  private async bumpVersion(tx: Tx, planId: string): Promise<void> {
    await tx.rate_plans.update({ where: { id: planId }, data: { version: { increment: 1 } } });
  }

  private async assertNoRuleConflict(
    tx: Tx,
    planId: string,
    candidate: RuleWindow,
    excludeRuleId?: string,
  ): Promise<void> {
    const siblings = await tx.rate_plan_rules.findMany({
      where: { rate_plan_id: planId, ...(excludeRuleId ? { id: { not: excludeRuleId } } : {}) },
    });
    for (const s of siblings) {
      if (s.priority !== candidate.priority) continue;
      if (
        rangeOverlaps(s.start_date, s.end_date, candidate.start, candidate.end) &&
        daysOverlap(s.days_of_week, candidate.days)
      ) {
        throw new AppException({
          code: 'RATE_PLAN_RULE_PRIORITY_OVERLAP',
          title: 'Đã có rule cùng độ ưu tiên chồng khoảng ngày — đổi priority hoặc khoảng',
          status: 422,
        });
      }
    }
  }

  private assertEffectiveWindow(dto: UpdateRatePlanRequest, plan: rate_plans): void {
    const from = dto.effective_from ?? plan.effective_from.toISOString().slice(0, 10);
    const to =
      dto.effective_to === undefined
        ? (plan.effective_to ? plan.effective_to.toISOString().slice(0, 10) : null)
        : dto.effective_to;
    if (to && from && to <= from) {
      throw new AppException({
        code: 'RATE_PLAN_INVALID_WINDOW',
        title: 'effective_to phải sau effective_from',
        status: 422,
      });
    }
  }

  private mergeDate(dtoVal: string | null | undefined, existing: Date | null): Date | null {
    if (dtoVal === undefined) return existing;
    return dtoVal === null ? null : ymdToDate(dtoVal);
  }

  private dateUpdate(dtoVal: string | null | undefined): Date | null | undefined {
    if (dtoVal === undefined) return undefined;
    return dtoVal === null ? null : ymdToDate(dtoVal);
  }

  private pricingWriteData(
    dto: CreateRatePlanRequest | UpdateRatePlanRequest,
  ): PricingWriteData {
    return {
      deposit_type: dto.deposit_type,
      deposit_value: bigOrU(dto.deposit_value),
      hourly_base_hours: dto.hourly_base_hours,
      hourly_extra_block_minutes: dto.hourly_extra_block_minutes,
      hourly_extra_block_price_vnd: bigOrU(dto.hourly_extra_block_price_vnd),
      hourly_overnight_surcharge_vnd: bigOrU(dto.hourly_overnight_surcharge_vnd),
      hourly_overnight_start: dto.hourly_overnight_start
        ? timeToDate(dto.hourly_overnight_start)
        : undefined,
      hourly_overnight_end: dto.hourly_overnight_end
        ? timeToDate(dto.hourly_overnight_end)
        : undefined,
      daily_checkin_time: dto.daily_checkin_time ? timeToDate(dto.daily_checkin_time) : undefined,
      daily_checkout_time: dto.daily_checkout_time
        ? timeToDate(dto.daily_checkout_time)
        : undefined,
      daily_early_checkin_fee_vnd: bigOrU(dto.daily_early_checkin_fee_vnd),
      daily_late_checkout_fee_vnd: bigOrU(dto.daily_late_checkout_fee_vnd),
      monthly_includes_utilities: dto.monthly_includes_utilities,
      monthly_electricity_per_kwh_vnd: bigOrU(dto.monthly_electricity_per_kwh_vnd),
      monthly_water_per_m3_vnd: bigOrU(dto.monthly_water_per_m3_vnd),
    };
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

  private async assertResourcesInProperty(
    tx: Tx,
    propertyId: string,
    resourceIds: string[],
  ): Promise<void> {
    const count = await tx.bookable_resources.count({
      where: { id: { in: resourceIds }, property_id: propertyId },
    });
    if (count !== resourceIds.length) {
      throw new AppException({
        code: 'RATE_PLAN_RESOURCES_INVALID',
        title: 'Một số resource không tồn tại hoặc không thuộc cơ sở này',
        status: 422,
      });
    }
  }

  private async loadOrThrow(id: string, user: JwtClaims): Promise<rate_plans> {
    const plan = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.rate_plans.findFirst({ where: { id } }),
      { readOnly: true },
    );
    if (!plan) {
      throw new AppException({
        code: 'RATE_PLAN_NOT_FOUND',
        title: 'Gói giá không tồn tại',
        status: 404,
      });
    }
    return plan;
  }
}
