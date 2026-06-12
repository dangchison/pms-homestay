import { Inject, Injectable } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import type Redis from 'ioredis';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { REDIS } from '@core/redis/redis.module';
import { withTenant } from '@core/tenancy/with-tenant';
import { ROLE_PERMISSIONS, type Permission } from './permissions';

const PERM_CACHE_TTL_SECONDS = 60;

interface PermissionOverride {
  grant?: string[];
  deny?: string[];
}

/**
 * Permission cache có version (docs/04 §4.6):
 * - `auth:pv:{userId}`: permission version — claim `pv` trong token phải khớp;
 *   MỌI mutation lên user_property_roles/role phải bump → token cũ bị từ chối
 *   ngay (thu hồi trong giây, không đợi 15').
 * - `perm:{userId}:{propertyId}`: effective permissions TTL 60s — tránh N+1.
 */
@Injectable()
export class PermissionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async getPermissionVersion(userId: string): Promise<number> {
    const raw = await this.redis.get(`auth:pv:${userId}`);
    return raw ? Number(raw) : 0;
  }

  /** Gọi sau MỌI thay đổi role/permission/password của user. */
  async bumpPermissionVersion(userId: string): Promise<void> {
    await this.redis.incr(`auth:pv:${userId}`);
    // Vô hiệu hoá cache permission-theo-property NGAY (không đợi TTL 60s) — giữ
    // đúng cam kết "thu hồi trong giây" của pv cho cả quyền theo property: quyền
    // vừa bị deny không còn dùng được sau khi user refresh token.
    const indexKey = `perm:idx:${userId}`;
    const cacheKeys = await this.redis.smembers(indexKey);
    if (cacheKeys.length > 0) await this.redis.del(...cacheKeys);
    await this.redis.del(indexKey);
  }

  /** Guard pha 1: token pv phải khớp version hiện tại (revocation nhanh). */
  async assertPermissionVersion(user: JwtClaims): Promise<void> {
    const current = await this.getPermissionVersion(user.sub);
    if (user.pv !== current) {
      throw new AppException({
        code: 'AUTH_TOKEN_STALE',
        title: 'Quyền đã thay đổi — cần refresh token',
        status: 401,
      });
    }
  }

  /**
   * Effective permissions của user trên MỘT property:
   * (role default ∪ grant) ∖ deny — đọc user_property_roles, cache 60s.
   */
  async effectivePermissions(
    user: Pick<JwtClaims, 'sub' | 'tnt'>,
    propertyId: string,
  ): Promise<ReadonlySet<string>> {
    const cacheKey = `perm:${user.sub}:${propertyId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return new Set(JSON.parse(cached) as string[]);

    const rows = await withTenant(
      this.prisma,
      user.tnt,
      (tx) =>
        tx.user_property_roles.findMany({
          where: { user_id: user.sub, property_id: propertyId },
          select: { role: true, permissions: true },
        }),
      { readOnly: true },
    );

    const effective = new Set<string>();
    for (const row of rows) {
      for (const p of ROLE_PERMISSIONS[row.role]) effective.add(p);
      const override = (row.permissions ?? {}) as PermissionOverride;
      for (const p of override.grant ?? []) effective.add(p);
      for (const p of override.deny ?? []) effective.delete(p);
    }

    await this.redis.set(cacheKey, JSON.stringify([...effective]), 'EX', PERM_CACHE_TTL_SECONDS);
    // Ghi key vào index theo user để bumpPermissionVersion vô hiệu hoá ngay được
    // (không dùng SCAN/KEYS — chặn block Redis ở prod). Index sống lâu hơn cache.
    const indexKey = `perm:idx:${user.sub}`;
    await this.redis.sadd(indexKey, cacheKey);
    await this.redis.expire(indexKey, PERM_CACHE_TTL_SECONDS + 10);
    return effective;
  }

  /**
   * ★ Pha 2 (docs/04 §4 — chống bypass property-scope): gọi SAU khi load entity,
   * propertyId lấy TỪ ENTITY (không tin params/body). OWNER pass toàn tenant.
   */
  async authorizeOnProperty(
    user: JwtClaims,
    propertyId: string,
    permission: Permission,
  ): Promise<void> {
    if (user.rol === 'OWNER') return;
    const perms = await this.effectivePermissions(user, propertyId);
    if (!perms.has(permission)) {
      throw new AppException({
        code: 'AUTHZ_PROPERTY_SCOPE',
        title: 'Không có quyền trên cơ sở này',
        status: 403,
      });
    }
  }
}
