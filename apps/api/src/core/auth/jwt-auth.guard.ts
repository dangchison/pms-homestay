import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';
import { AppException } from '@core/http/exceptions/app.exception';
import { IS_PUBLIC_KEY } from '@core/http/decorators/public.decorator';
import { TokenService } from './token.service';

/**
 * Verify Bearer access token (docs/04 §2). Sau khi verify:
 * - req.user = claims (đã validate shape)
 * - req.tenantId = claims.tnt — GHI ĐÈ giá trị decode-không-verify của
 *   TenantResolverMiddleware (nguồn sự thật sau đăng nhập là token đã verify).
 * Bỏ qua với @Public() (health, /auth/login, ...).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new AppException({
        code: 'AUTH_UNAUTHENTICATED',
        title: 'Cần đăng nhập',
        status: 401,
      });
    }

    try {
      const claims = this.tokenService.verifyAccessToken(authorization.slice('Bearer '.length));
      req.user = claims;
      req.tenantId = claims.tnt;
      return true;
    } catch {
      throw new AppException({
        code: 'AUTH_TOKEN_INVALID',
        title: 'Token không hợp lệ hoặc đã hết hạn',
        status: 401,
      });
    }
  }
}
