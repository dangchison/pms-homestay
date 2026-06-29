import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { type PlatformClaims, PlatformClaimsSchema } from '@pms/shared-types';
import { ENV, type Env } from '@core/config/env.schema';
import { AppException } from '@core/http/exceptions/app.exception';

/** Platform access token sống 1h — KHÔNG refresh (admin nền tảng đăng nhập lại). */
export const PLATFORM_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * Ký/verify JWT cho admin nền tảng (B4). Dùng JWT_PLATFORM_SECRET — TÁCH biệt
 * JWT_ACCESS_SECRET (token tenant) nên token tenant không verify được ở đây và
 * ngược lại (cộng thêm claim `typ: 'platform'`). Thiếu secret → 503.
 */
@Injectable()
export class PlatformTokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private secretOrThrow(): string {
    const secret = this.env.JWT_PLATFORM_SECRET;
    if (!secret) {
      throw new AppException({
        code: 'PLATFORM_AUTH_NOT_CONFIGURED',
        title: 'Chưa cấu hình JWT_PLATFORM_SECRET',
        status: 503,
      });
    }
    return secret;
  }

  issue(admin: { id: string; email: string }): string {
    return this.jwt.sign(
      { sub: admin.id, eml: admin.email, typ: 'platform', jti: randomUUID() },
      { secret: this.secretOrThrow(), expiresIn: PLATFORM_ACCESS_TOKEN_TTL_SECONDS },
    );
  }

  /** Verify chữ ký + shape claims; ném nếu không hợp lệ/hết hạn/sai typ. */
  verify(token: string): PlatformClaims {
    const payload = this.jwt.verify(token, { secret: this.secretOrThrow() });
    const claims = PlatformClaimsSchema.parse(payload);
    if (claims.typ !== 'platform') throw new Error('typ phải là platform');
    return claims;
  }
}
