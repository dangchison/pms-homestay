import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { type CookieOptions, type Request, type Response } from 'express';
import { ENV, type Env } from '@core/config/env.schema';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { Public } from '@core/http/decorators/public.decorator';
import { SkipTenantScope } from '@core/http/decorators/skip-tenant.decorator';
import { AppException } from '@core/http/exceptions/app.exception';
import { AuthService, type IssuedTokens, type RequestContext } from './auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  TwoFaDisableDto,
  TwoFaVerifyDto,
} from './dto';

const REFRESH_COOKIE = 'refresh_token';
const CSRF_COOKIE = 'csrf_token';
const REFRESH_COOKIE_PATH = '/api/v1/auth';
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * /api/v1/auth/* (docs/04 §2 endpoints).
 * Refresh token: cookie HttpOnly, Path=/api/v1/auth; CSRF double-submit trên
 * endpoint dùng cookie (refresh/logout): header X-CSRF-Token phải khớp cookie.
 * Cookie CSRF cố ý KHÔNG HttpOnly và đặt ở Path=/ — xem csrfCookieOptions().
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('register')
  @Public()
  @SkipTenantScope()
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const issued = await this.authService.login(dto, this.ctx(req));
    this.setAuthCookies(res, issued);
    return { data: issued.body };
  }

  @Post('refresh')
  @Public()
  @SkipTenantScope()
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertCsrf(req);
    const issued = await this.authService.refresh(this.refreshCookie(req), this.ctx(req));
    this.setAuthCookies(res, issued);
    return { data: issued.body };
  }

  @Post('logout')
  @Public()
  @SkipTenantScope()
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertCsrf(req);
    await this.authService.logout(this.refreshCookie(req));
    this.clearAuthCookies(res);
  }

  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@CurrentUser() user: JwtClaims, @Res({ passthrough: true }) res: Response) {
    await this.authService.logoutAll(user);
    this.clearAuthCookies(res);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(204)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    // Luôn 204 — không lộ email nào tồn tại (user enumeration)
    await this.authService.forgotPassword(dto.email, req.tenantId);
  }

  @Post('reset-password')
  @Public()
  @SkipTenantScope()
  @HttpCode(204)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
  }

  @Post('2fa/enable')
  @HttpCode(200)
  async twoFaEnable(@CurrentUser() user: JwtClaims) {
    return { data: await this.authService.twoFaEnable(user) };
  }

  @Post('2fa/verify')
  @HttpCode(204)
  async twoFaVerify(@CurrentUser() user: JwtClaims, @Body() dto: TwoFaVerifyDto) {
    await this.authService.twoFaVerify(user, dto.totp_code);
  }

  @Post('2fa/disable')
  @HttpCode(204)
  async twoFaDisable(@CurrentUser() user: JwtClaims, @Body() dto: TwoFaDisableDto) {
    await this.authService.twoFaDisable(user, dto.totp_code);
  }

  @Post('change-password')
  @HttpCode(204)
  async changePassword(@CurrentUser() user: JwtClaims, @Body() dto: ChangePasswordDto) {
    await this.authService.changePassword(user, dto.current_password, dto.new_password);
  }

  @Get('sessions')
  async sessions(@CurrentUser() user: JwtClaims, @Req() req: Request) {
    return { data: await this.authService.listSessions(user, this.refreshCookie(req)) };
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(
    @CurrentUser() user: JwtClaims,
    @Param('id', ParseUUIDPipe) sessionId: string,
  ) {
    await this.authService.revokeSession(user, sessionId);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private ctx(req: Request): RequestContext {
    const cfIp = req.headers['cf-connecting-ip'];
    return {
      tenantId: req.tenantId,
      // Sau Cloudflare: CF-Connecting-IP là IP thật (docs/04 §3); fallback req.ip
      ip: (Array.isArray(cfIp) ? cfIp[0] : cfIp) ?? req.ip ?? 'unknown',
      userAgent: req.headers['user-agent'],
    };
  }

  private refreshCookie(req: Request): string | undefined {
    return (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  }

  /** CSRF double-submit (docs/04 §2): header phải khớp cookie. */
  private assertCsrf(req: Request): void {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE];
    const header = req.headers['x-csrf-token'];
    const headerValue = Array.isArray(header) ? header[0] : header;
    if (!cookie || !headerValue || cookie !== headerValue) {
      throw new AppException({
        code: 'AUTH_CSRF_MISMATCH',
        title: 'CSRF token không hợp lệ',
        status: 403,
      });
    }
  }

  /** Thuộc tính dùng chung cho cả hai cookie auth. */
  private baseCookieOptions(): CookieOptions {
    return {
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'lax',
      ...(this.env.COOKIE_DOMAIN ? { domain: this.env.COOKIE_DOMAIN } : {}),
    };
  }

  /** Refresh token: bí mật thật — HttpOnly, chỉ gửi tới /api/v1/auth. */
  private refreshCookieOptions(): CookieOptions {
    return { ...this.baseCookieOptions(), httpOnly: true, path: REFRESH_COOKIE_PATH };
  }

  /**
   * CSRF token: `httpOnly: false` + `path: '/'` là CỐ Ý, không phải sơ suất.
   *
   * Double-submit đòi hỏi trình duyệt đọc được cookie để gửi lại qua header
   * `X-CSRF-Token` — token này không phải bí mật chống XSS (dưới XSS thì access
   * token in-memory đã mất trước rồi). Refresh token vẫn HttpOnly, không đổi.
   *
   * `path` phải là '/' chứ không phải '/api/v1/auth': `document.cookie` chỉ trả về
   * cookie path-match với document HIỆN TẠI, mà trang chạy ở '/'. Để nguyên path cũ
   * thì dù bỏ HttpOnly, JS vẫn không đọc được — và mọi lần tải lại trang đều mất
   * phiên vì /auth/refresh trả 403 AUTH_CSRF_MISMATCH.
   */
  private csrfCookieOptions(): CookieOptions {
    return { ...this.baseCookieOptions(), httpOnly: false, path: '/' };
  }

  private setAuthCookies(res: Response, issued: IssuedTokens): void {
    res.cookie(REFRESH_COOKIE, issued.refreshCookie, {
      ...this.refreshCookieOptions(),
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
    // Xoá cookie CSRF ở path CŨ trước khi set path mới. Trình duyệt của người dùng
    // hiện tại đang giữ csrf_token ở Path=/api/v1/auth; nếu không xoá thì tồn tại
    // HAI cookie trùng tên, request tới /api/v1/auth/refresh gửi cả hai, và cookie
    // có path cụ thể hơn đứng TRƯỚC — cookie-parser lấy đúng cái cũ đã stale nên
    // assertCsrf hỏng vĩnh viễn. Giữ dòng này tối thiểu một chu kỳ refresh token
    // (REFRESH_COOKIE_MAX_AGE_MS = 30 ngày) rồi mới gỡ được.
    res.clearCookie(CSRF_COOKIE, { ...this.baseCookieOptions(), path: REFRESH_COOKIE_PATH });
    res.cookie(CSRF_COOKIE, issued.body.csrf_token, {
      ...this.csrfCookieOptions(),
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
  }

  private clearAuthCookies(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, this.refreshCookieOptions());
    res.clearCookie(CSRF_COOKIE, this.csrfCookieOptions());
    res.clearCookie(CSRF_COOKIE, { ...this.baseCookieOptions(), path: REFRESH_COOKIE_PATH });
  }
}
