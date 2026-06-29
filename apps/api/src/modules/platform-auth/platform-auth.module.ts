import { Module } from '@nestjs/common';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformTokenService } from './platform-token.service';

/**
 * Platform-auth (B4, docs/14 §4.7) — đăng nhập admin nền tảng (`platform_users`) +
 * guard cho endpoint platform, THAY cơ chế header `PLATFORM_ADMIN_SECRET`. JwtService
 * lấy từ AuthCoreModule (@Global). Export guard + token service cho module có endpoint
 * platform (SubscriptionModule → confirm thanh toán thuê bao).
 */
@Module({
  controllers: [PlatformAuthController],
  providers: [PlatformAuthService, PlatformTokenService, PlatformAuthGuard],
  exports: [PlatformTokenService, PlatformAuthGuard],
})
export class PlatformAuthModule {}
