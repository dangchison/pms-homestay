import { Injectable } from '@nestjs/common';
import { type JwtClaims, type Tenant, type UpdateTenantRequest } from '@pms/shared-types';
import { type tenants } from '@prisma/client';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';

function toTenant(t: tenants): Tenant {
  return {
    id: t.id,
    slug: t.slug,
    display_name: t.display_name,
    business_type: t.business_type,
    status: t.status as Tenant['status'],
    subscription_plan_id: t.subscription_plan_id,
    trial_ends_at: t.trial_ends_at ? t.trial_ends_at.toISOString() : null,
    timezone: t.timezone,
    currency: t.currency,
    created_at: t.created_at.toISOString(),
    updated_at: t.updated_at.toISOString(),
  };
}

/**
 * Hồ sơ tenant (task 6.7 S1). `tenants` là bảng GỐC (mỗi user chỉ thuộc 1 tenant
 * đã verify trong JWT) → truy cập trực tiếp bằng `id = user.tnt` (ADR-0002 §5,
 * giống SubscriptionService). slug/status/plan read-only (đổi qua billing).
 */
@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async get(user: JwtClaims): Promise<Tenant> {
    // eslint-disable-next-line no-restricted-syntax -- bảng tenants GỐC, lọc theo user.tnt đã verify (ADR-0002 §5)
    const t = await this.prisma.tenants.findUnique({ where: { id: user.tnt } });
    if (!t) {
      throw new AppException({ code: 'TENANT_NOT_FOUND', title: 'Không tìm thấy tenant', status: 404 });
    }
    return toTenant(t);
  }

  async update(user: JwtClaims, dto: UpdateTenantRequest): Promise<Tenant> {
    // eslint-disable-next-line no-restricted-syntax -- bảng tenants GỐC, lọc theo user.tnt đã verify (ADR-0002 §5)
    const updated = await this.prisma.tenants.update({
      where: { id: user.tnt },
      data: {
        ...(dto.display_name !== undefined ? { display_name: dto.display_name } : {}),
        ...(dto.business_type !== undefined ? { business_type: dto.business_type } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
      },
    });
    return toTenant(updated);
  }
}
