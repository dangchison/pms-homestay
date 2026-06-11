import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtClaimsSchema, type JwtClaims, type UserRole } from '@pms/shared-types';
import { ENV, type Env } from '@core/config/env.schema';

/** Access token sống 15' — CỐ ĐỊNH, không config (docs/04 §2). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export interface IssueAccessTokenInput {
  userId: string;
  tenantId: string;
  role: UserRole;
  /** property ids — CHỈ để render UI, không dùng authorize (docs/04 §2) */
  scope: string[];
  permissionVersion: number;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  issueAccessToken(input: IssueAccessTokenInput): string {
    return this.jwt.sign(
      {
        sub: input.userId,
        tnt: input.tenantId,
        rol: input.role,
        scp: input.scope,
        pv: input.permissionVersion,
        jti: randomUUID(),
        typ: 'access',
      },
      { secret: this.env.JWT_ACCESS_SECRET, expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );
  }

  /** Verify chữ ký + shape claims; ném lỗi nếu không hợp lệ/hết hạn. */
  verifyAccessToken(token: string): JwtClaims {
    const payload = this.jwt.verify(token, { secret: this.env.JWT_ACCESS_SECRET });
    const claims = JwtClaimsSchema.parse(payload);
    if (claims.typ !== 'access') throw new Error('typ phải là access');
    return claims;
  }
}
