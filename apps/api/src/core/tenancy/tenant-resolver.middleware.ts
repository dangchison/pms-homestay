import { Injectable, type NestMiddleware } from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { HEADER_TENANT_SLUG } from '@/shared/constants';

/**
 * Resolve tenant context cho request (docs/02 §resolution), ưu tiên:
 *   1. JWT claim `tnt` (sau đăng nhập — nguồn sự thật)
 *   2. Subdomain: acme.pmsapp.vn → slug "acme"
 *   3. Header X-Tenant-Slug (dev/mobile)
 *
 * Chỉ GẮN req.tenantId — việc chặn endpoint thiếu tenant là của TenantGuard
 * (tôn trọng @Public/@SkipTenantScope).
 *
 * LƯU Ý BẢO MẬT: claim `tnt` ở đây decode KHÔNG verify chữ ký — JwtAuthGuard
 * (task 1.7) verify token, PermissionsGuard (task 1.8) cross-check
 * user.tnt === req.tenantId trước khi cho mutation chạy (docs/04 §guard).
 */
@Injectable()
export class TenantResolverMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const fromJwt = tenantIdFromBearer(req.headers.authorization);
    if (fromJwt) {
      req.tenantId = fromJwt;
      next();
      return;
    }

    const slug = slugFromHost(req.headers.host) ?? headerSlug(req);
    if (slug) {
      const tenant = await this.prisma.tenants.findUnique({
        where: { slug },
        select: { id: true, status: true },
      });
      if (!tenant) {
        throw new AppException({
          code: 'TENANT_NOT_FOUND',
          title: 'Tenant không tồn tại',
          status: 404,
        });
      }
      if (tenant.status === 'SUSPENDED' || tenant.status === 'CHURNED') {
        throw new AppException({
          code: `TENANT_${tenant.status}`,
          title: 'Tài khoản đã bị tạm ngưng hoặc đóng',
          status: 403,
        });
      }
      req.tenantId = tenant.id;
    }

    next();
  }
}

/** Decode (không verify) claim tnt từ Bearer token — xem ghi chú bảo mật ở trên. */
function tenantIdFromBearer(authorization?: string): string | undefined {
  if (!authorization?.startsWith('Bearer ')) return undefined;
  const payload = authorization.slice('Bearer '.length).split('.')[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      tnt?: unknown;
    };
    return typeof claims.tnt === 'string' ? claims.tnt : undefined;
  } catch {
    return undefined;
  }
}

/** acme.pmsapp.vn → "acme"; bỏ qua localhost/IP/label hệ thống. */
function slugFromHost(host?: string): string | undefined {
  if (!host) return undefined;
  const hostname = host.split(':')[0]!;
  if (hostname === 'localhost' || /^[\d.]+$/.test(hostname)) return undefined;
  const parts = hostname.split('.');
  if (parts.length < 3) return undefined;
  const sub = parts[0]!;
  if (['www', 'api', 'app', 'admin', 'staff'].includes(sub)) return undefined;
  return sub;
}

function headerSlug(req: Request): string | undefined {
  const raw = req.headers[HEADER_TENANT_SLUG.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || undefined;
}
