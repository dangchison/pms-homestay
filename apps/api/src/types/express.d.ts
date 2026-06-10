import { type JwtClaims } from '@pms/shared-types';

declare global {
  namespace Express {
    interface Request {
      /** Gắn bởi TenantResolverMiddleware (docs/02) */
      tenantId?: string;
      /** Gắn bởi JwtStrategy (task 1.7) */
      user?: JwtClaims;
    }
  }
}

export {};
