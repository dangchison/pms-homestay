import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type Redis from 'ioredis';
import { Public } from '@core/http/decorators/public.decorator';
import { SkipTenantScope } from '@core/http/decorators/skip-tenant.decorator';
import { PrismaService } from '@core/prisma/prisma.service';
import { REDIS } from '@core/redis/redis.module';

/**
 * Health endpoints (docs/11 §5) — public, KHÔNG lộ topology/chi tiết hệ thống,
 * chỉ trả status.
 */
@Controller('health')
@Public()
@SkipTenantScope()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Process còn sống — không đụng dependency. */
  @Get('liveness')
  liveness() {
    return { status: 'ok' };
  }

  /** Sẵn sàng nhận traffic: DB + Redis trả lời. */
  @Get('readiness')
  async readiness() {
    const [db, redis] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
    ]);
    if (db.status === 'rejected' || redis.status === 'rejected') {
      throw new ServiceUnavailableException({ status: 'degraded' });
    }
    return { status: 'ok' };
  }

  /** Migration đã áp dụng chưa (bảng pgmigrations có dữ liệu). */
  @Get('startup')
  async startup() {
    try {
      const rows = await this.prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*)::bigint AS count FROM pgmigrations`;
      if ((rows[0]?.count ?? 0n) === 0n) {
        throw new Error('chưa có migration nào được áp dụng');
      }
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'not-migrated' });
    }
  }
}
