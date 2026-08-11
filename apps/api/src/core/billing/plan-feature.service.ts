import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '@core/prisma/prisma.service';
import { REDIS } from '@core/redis/redis.module';
import { type PlanFeature } from './plan-feature';

const FEATURES_CACHE_TTL_SECONDS = 60;

/** Gói + cờ tính năng của tenant, dạng đã cache. */
export interface TenantPlanFeatures {
  plan_code: string;
  features: Record<string, unknown>;
}

/**
 * Cờ tính năng theo gói thuê bao — nguồn cho PlanFeatureGuard. Cache Redis 60s
 * cùng kiểu TenantStatusService: đổi gói (confirm payment, platform admin sửa
 * hạn mức) gọi `invalidate` để có hiệu lực ngay, cron chấp nhận trễ tối đa TTL.
 */
@Injectable()
export class PlanFeatureService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private key(tenantId: string): string {
    return `tenant:plan-features:${tenantId}`;
  }

  /** null = tenant không tồn tại hoặc chưa gán gói (không áp giới hạn). */
  async get(tenantId: string): Promise<TenantPlanFeatures | null> {
    const cached = await this.redis.get(this.key(tenantId));
    if (cached) return JSON.parse(cached) as TenantPlanFeatures;

    // tenants/subscription_plans GLOBAL không RLS (ADR-0002 §5) — đọc trực tiếp.
    const tenant = await this.prisma.tenants.findUnique({
      where: { id: tenantId },
      select: { subscription_plans: { select: { code: true, features: true } } },
    });
    const plan = tenant?.subscription_plans;
    if (!plan) return null;

    const value: TenantPlanFeatures = {
      plan_code: plan.code,
      features: (plan.features ?? {}) as Record<string, unknown>,
    };
    await this.redis.set(this.key(tenantId), JSON.stringify(value), 'EX', FEATURES_CACHE_TTL_SECONDS);
    return value;
  }

  async has(tenantId: string, feature: PlanFeature): Promise<boolean | null> {
    const plan = await this.get(tenantId);
    if (!plan) return null;
    return plan.features[feature] === true;
  }

  /** Xoá cache NGAY sau khi đổi gói. */
  async invalidate(tenantId: string): Promise<void> {
    await this.redis.del(this.key(tenantId));
  }
}
