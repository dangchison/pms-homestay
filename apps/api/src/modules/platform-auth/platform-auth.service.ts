import { Injectable, Logger } from '@nestjs/common';
import { type PlatformLoginRequest, type PlatformLoginResponse } from '@pms/shared-types';
import * as argon2 from 'argon2';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { PLATFORM_ACCESS_TOKEN_TTL_SECONDS, PlatformTokenService } from './platform-token.service';

/**
 * Đăng nhập admin nền tảng (B4, docs/14 §4.7). `platform_users` là bảng GLOBAL
 * (không tenant, không RLS) → query trực tiếp, KHÔNG withTenant. Sai email/mật khẩu
 * hoặc tài khoản bị khoá → 401 đồng nhất (không lộ email nào tồn tại).
 */
@Injectable()
export class PlatformAuthService {
  private readonly logger = new Logger(PlatformAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: PlatformTokenService,
  ) {}

  async login(dto: PlatformLoginRequest): Promise<PlatformLoginResponse> {
    // eslint-disable-next-line no-restricted-syntax -- platform_users là bảng global (không tenant/RLS)
    const admin = await this.prisma.platform_users.findFirst({ where: { email: dto.email } });
    if (!admin || !admin.is_active) throw this.invalidCredentials();

    const ok = await argon2.verify(admin.password_hash, dto.password).catch(() => false);
    if (!ok) throw this.invalidCredentials();

    // eslint-disable-next-line no-restricted-syntax -- platform_users là bảng global (không tenant/RLS)
    await this.prisma.platform_users.update({
      where: { id: admin.id },
      data: { last_login_at: new Date() },
    });
    this.logger.log(`Platform admin login: ${admin.email}`);

    return {
      access_token: this.tokens.issue({ id: admin.id, email: admin.email }),
      token_type: 'Bearer',
      expires_in: PLATFORM_ACCESS_TOKEN_TTL_SECONDS,
      admin: { id: admin.id, email: admin.email, full_name: admin.full_name },
    };
  }

  private invalidCredentials(): AppException {
    return new AppException({
      code: 'PLATFORM_INVALID_CREDENTIALS',
      title: 'Email hoặc mật khẩu không đúng',
      status: 401,
    });
  }
}
