import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';

/**
 * Lấy user từ request (JwtStrategy gắn ở task 1.7).
 * Scaffold: req.user chưa được set cho tới khi auth module hoàn thành.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtClaims | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: JwtClaims }>();
    return request.user;
  },
);
