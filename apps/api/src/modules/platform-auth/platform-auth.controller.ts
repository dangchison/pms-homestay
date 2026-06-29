import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Public } from '@core/http/decorators/public.decorator';
import { SkipTenantScope } from '@core/http/decorators/skip-tenant.decorator';
import { PlatformLoginDto } from './dto';
import { PlatformAuthService } from './platform-auth.service';

/**
 * /api/v1/platform/auth — đăng nhập admin nền tảng (B4, docs/14 §4.7). Module
 * RIÊNG, không dùng JWT tenant: token ký bằng JWT_PLATFORM_SECRET, `typ: 'platform'`.
 * @Public + @SkipTenantScope: chạy ngoài tenant scope, không cần JWT tenant.
 */
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Post('login')
  @Public()
  @SkipTenantScope()
  @HttpCode(200)
  async login(@Body() dto: PlatformLoginDto) {
    return { data: await this.auth.login(dto) };
  }
}
