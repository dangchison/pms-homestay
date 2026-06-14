import { Inject, Injectable } from '@nestjs/common';
import { type TenantStatus } from '@pms/shared-types';
import type Redis from 'ioredis';
import { PrismaService } from '@core/prisma/prisma.service';
import { REDIS } from '@core/redis/redis.module';

const STATUS_CACHE_TTL_SECONDS = 60;

/**
 * Trạng thái thuê bao tenant (task 4.7) — nguồn cho TenantStatusGuard chặn write
 * khi SUSPENDED/CHURNED. Cache Redis 60s (tránh đọc DB mỗi request); đổi trạng
 * thái (payment confirm) gọi `invalidate` để bỏ chặn NGAY. Cron lifecycle chạy
 * 2am chấp nhận trễ tối đa TTL (không invalidate hàng loạt).
 */
@Injectable()
export class TenantStatusService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private key(tenantId: string): string {
    return `tenant:status:${tenantId}`;
  }

  /** Trạng thái tenant (cache 60s); null nếu tenant không tồn tại. */
  async getStatus(tenantId: string): Promise<TenantStatus | null> {
    const cached = await this.redis.get(this.key(tenantId));
    if (cached) return cached as TenantStatus;
    const tenant = await this.prisma.tenants.findUnique({
      where: { id: tenantId },
      select: { status: true },
    });
    if (!tenant) return null;
    await this.redis.set(this.key(tenantId), tenant.status, 'EX', STATUS_CACHE_TTL_SECONDS);
    return tenant.status as TenantStatus;
  }

  /** Xoá cache NGAY sau khi đổi trạng thái (payment confirm). */
  async invalidate(tenantId: string): Promise<void> {
    await this.redis.del(this.key(tenantId));
  }
}
