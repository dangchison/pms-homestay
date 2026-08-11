import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type PlatformClaims } from '@pms/shared-types';

/** Admin nền tảng đang đăng nhập — PlatformAuthGuard gắn `req.platformAdmin`. */
export const CurrentPlatformAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PlatformClaims | undefined =>
    ctx.switchToHttp().getRequest<{ platformAdmin?: PlatformClaims }>().platformAdmin,
);
