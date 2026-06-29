import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { type PlatformClaims } from '@pms/shared-types';
import { type Request } from 'express';
import { AppException } from '@core/http/exceptions/app.exception';
import { PlatformTokenService } from './platform-token.service';

/**
 * Bảo vệ endpoint platform (B4) — verify Bearer token nền tảng. Dùng cho route đã
 * @Public() (JwtAuthGuard tenant bỏ qua) + @SkipTenantScope(). Token tenant KHÔNG
 * qua được (khác secret + sai `typ`). Thiếu cấu hình → 503 (nổi nguyên từ token svc).
 */
@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(private readonly tokens: PlatformTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { platformAdmin?: PlatformClaims }>();
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new AppException({
        code: 'PLATFORM_UNAUTHENTICATED',
        title: 'Cần đăng nhập platform',
        status: 401,
      });
    }
    try {
      req.platformAdmin = this.tokens.verify(authorization.slice('Bearer '.length));
      return true;
    } catch (err) {
      if (err instanceof AppException) throw err; // 503 chưa cấu hình → giữ nguyên
      throw new AppException({
        code: 'PLATFORM_TOKEN_INVALID',
        title: 'Token platform không hợp lệ hoặc đã hết hạn',
        status: 401,
      });
    }
  }
}
