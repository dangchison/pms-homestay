import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type AuthTokensResponse,
  type JwtClaims,
  type LoginRequest,
  type RegisterTenantRequest,
  type ResetPasswordRequest,
  type SessionInfo,
} from '@pms/shared-types';
import * as argon2 from 'argon2';
import type Redis from 'ioredis';
import { PermissionService } from '@core/auth/permission.service';
import { ACCESS_TOKEN_TTL_SECONDS, TokenService } from '@core/auth/token.service';
import { ENV, type Env } from '@core/config/env.schema';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { REDIS } from '@core/redis/redis.module';
import { withTenant } from '@core/tenancy/with-tenant';
import { COMMON_PASSWORDS } from './assets/common-passwords';
import { MailerService } from './mailer.service';
import {
  ACCOUNT_FAIL_LIMIT,
  ACCOUNT_LOCK_MINUTES,
  ThrottleService,
} from './throttle.service';
import { TwoFactorService } from './two-factor.service';

/** Tham số Argon2id theo docs/04 §3 (OWASP). */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

const TRIAL_DAYS = 14;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày sliding
const ROTATION_GRACE_MS = 60_000;
const RESET_TOKEN_TTL_SECONDS = 30 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RequestContext {
  tenantId?: string;
  ip: string;
  userAgent?: string;
}

export interface IssuedTokens {
  body: AuthTokensResponse;
  refreshCookie: string;
}

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  default_role: 'OWNER' | 'MANAGER' | 'STAFF' | 'HOUSEKEEPER' | 'ACCOUNTANT';
  password_hash: string;
  is_active: boolean;
  locked_until: Date | null;
  two_factor_enabled: boolean;
  two_factor_secret: string | null;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Cookie refresh mang sẵn tenant prefix — refresh không cần subdomain/header. */
function newRefreshPlain(tenantId: string): string {
  return `${tenantId}.${randomBytes(48).toString('base64url')}`;
}

function tenantFromRefreshPlain(plain: string): string | undefined {
  const tenantId = plain.split('.')[0];
  return tenantId && UUID_RE.test(tenantId) ? tenantId : undefined;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly permissionService: PermissionService,
    private readonly throttle: ThrottleService,
    private readonly twoFactor: TwoFactorService,
    private readonly mailer: MailerService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ── Register (docs/04: tenant + OWNER, trial 14 ngày) ─────────────────────

  async register(dto: RegisterTenantRequest): Promise<{
    tenant: { id: string; slug: string; trial_ends_at: string };
    user: { id: string; email: string; role: 'OWNER' };
  }> {
    this.assertPasswordStrong(dto.password);
    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
    const tenantId = randomUUID();
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    // Tenant + OWNER trong MỘT transaction — GUC = tenantId mới nên RLS
    // WITH CHECK trên users pass; tenants là bảng global (không RLS).
    const result = await withTenant(this.prisma, tenantId, async (tx) => {
      const slugTaken = await tx.tenants.findUnique({ where: { slug: dto.tenant_slug } });
      if (slugTaken) {
        throw new AppException({
          code: 'TENANT_SLUG_TAKEN',
          title: 'Tên miền tenant đã được sử dụng',
          status: 409,
        });
      }
      const freePlan = await tx.subscription_plans.findUnique({ where: { code: 'FREE' } });

      const tenant = await tx.tenants.create({
        data: {
          id: tenantId,
          slug: dto.tenant_slug,
          display_name: dto.tenant_display_name,
          status: 'TRIAL',
          trial_ends_at: trialEndsAt,
          subscription_plan_id: freePlan?.id,
        },
      });
      const user = await tx.users.create({
        data: {
          tenant_id: tenantId,
          email: dto.email,
          password_hash: passwordHash,
          full_name: dto.full_name,
          default_role: 'OWNER',
        },
      });
      return { tenant, user };
    });

    return {
      tenant: {
        id: result.tenant.id,
        slug: result.tenant.slug,
        trial_ends_at: trialEndsAt.toISOString(),
      },
      user: { id: result.user.id, email: result.user.email, role: 'OWNER' },
    };
  }

  // ── Login (docs/04 §2–3) ───────────────────────────────────────────────────

  async login(dto: LoginRequest, ctx: RequestContext): Promise<IssuedTokens> {
    const tenantId = ctx.tenantId;
    if (!tenantId) {
      throw new AppException({
        code: 'TENANT_CONTEXT_MISSING',
        title: 'Đăng nhập cần subdomain tenant hoặc header X-Tenant-Slug',
        status: 400,
      });
    }

    if (await this.throttle.ipRequiresCaptcha(ctx.ip)) {
      throw new AppException({
        code: 'AUTH_CAPTCHA_REQUIRED',
        title: 'Quá nhiều lần thử — cần xác minh captcha',
        status: 429,
      });
    }

    const user = await withTenant(
      this.prisma,
      tenantId,
      (tx) => tx.users.findFirst({ where: { email: dto.email } }) as Promise<UserRow | null>,
      { readOnly: true },
    );

    if (!user || !user.is_active) {
      await this.registerLoginFailure(tenantId, dto.email, ctx.ip, user);
      throw this.invalidCredentials();
    }
    if (user.locked_until && user.locked_until > new Date()) {
      throw new AppException({
        code: 'AUTH_ACCOUNT_LOCKED',
        title: 'Tài khoản tạm khoá do đăng nhập sai nhiều lần',
        status: 423,
        detail: `Thử lại sau ${user.locked_until.toISOString()}`,
      });
    }

    const passwordOk = await argon2.verify(user.password_hash, dto.password);
    if (!passwordOk) {
      await this.registerLoginFailure(tenantId, dto.email, ctx.ip, user);
      throw this.invalidCredentials();
    }

    // Bắt buộc 2FA cho vai trò đặc quyền (task 8.4, docs/04 §3) — gated env flag,
    // mặc định tắt. Bật ở prod sau khi owner/accountant đã enroll (grace-period).
    if (
      this.env.ENFORCE_2FA_FOR_PRIVILEGED_ROLES &&
      !user.two_factor_enabled &&
      (user.default_role === 'OWNER' || user.default_role === 'ACCOUNTANT')
    ) {
      throw new AppException({
        code: 'AUTH_2FA_REQUIRED_FOR_ROLE',
        title: 'Vai trò này bắt buộc bật xác thực 2 lớp (2FA)',
        status: 403,
        detail: 'Bật 2FA cho tài khoản trước khi đăng nhập (liên hệ quản trị nếu cần).',
      });
    }

    // Bước 2FA (docs/04 §3)
    let updatedTwoFaPayload: string | undefined;
    if (user.two_factor_enabled) {
      if (!dto.totp_code) {
        throw new AppException({
          code: 'AUTH_2FA_REQUIRED',
          title: 'Cần mã xác thực 2 lớp',
          status: 401,
        });
      }
      const verdict = this.twoFactor.verify(user.two_factor_secret!, dto.totp_code);
      if (!verdict.ok) {
        await this.registerLoginFailure(tenantId, dto.email, ctx.ip, user);
        throw new AppException({
          code: 'AUTH_2FA_CODE_INVALID',
          title: 'Mã xác thực không đúng',
          status: 401,
        });
      }
      updatedTwoFaPayload = verdict.updatedPayload; // backup code đã tiêu thụ
    }

    await this.throttle.clearAccountFailures(tenantId, dto.email);

    const refreshPlain = newRefreshPlain(tenantId);
    await withTenant(this.prisma, tenantId, async (tx) => {
      await tx.users.update({
        where: { id: user.id },
        data: {
          last_login_at: new Date(),
          failed_login_count: 0,
          locked_until: null,
          ...(updatedTwoFaPayload ? { two_factor_secret: updatedTwoFaPayload } : {}),
        },
      });
      await tx.refresh_tokens.create({
        data: {
          tenant_id: tenantId,
          user_id: user.id,
          token_hash: sha256Hex(refreshPlain),
          ip_address: ctx.ip,
          user_agent: ctx.userAgent,
          expires_at: new Date(Date.now() + REFRESH_TTL_MS),
        },
      });
    });

    return this.issueTokens(user, refreshPlain);
  }

  // ── Refresh rotation + grace window (docs/04 §2) ───────────────────────────

  async refresh(refreshCookie: string | undefined, ctx: RequestContext): Promise<IssuedTokens> {
    const tenantId = refreshCookie && tenantFromRefreshPlain(refreshCookie);
    if (!refreshCookie || !tenantId) throw this.refreshInvalid();

    const presentedHash = sha256Hex(refreshCookie);
    const successorPlain = newRefreshPlain(tenantId); // sinh trước — trong tx không random thêm

    // Pha DB (KHÔNG external I/O trong withTenant — ADR-0002)
    const outcome = await withTenant(this.prisma, tenantId, async (tx) => {
      // Row-lock token đang active để serialize double-refresh
      await tx.$queryRaw`
        SELECT id FROM refresh_tokens
        WHERE token_hash = ${presentedHash} AND revoked_at IS NULL
        FOR UPDATE`;

      const record = await tx.refresh_tokens.findFirst({
        where: { token_hash: presentedHash },
      });
      if (!record || record.expires_at < new Date()) return { action: 'invalid' as const };

      const user = (await tx.users.findFirst({
        where: { id: record.user_id },
      })) as UserRow | null;
      if (!user || !user.is_active) return { action: 'invalid' as const };

      if (record.revoked_at) {
        const withinGrace = Date.now() - record.revoked_at.getTime() < ROTATION_GRACE_MS;
        if (withinGrace && record.rotated_to) {
          // Double-refresh vô hại — trả token kế nhiệm idempotent (qua Redis cache)
          return { action: 'grace' as const, user };
        }
        // Reuse THẬT → giết cả chain (docs/04 §2)
        await tx.refresh_tokens.updateMany({
          where: { user_id: record.user_id, revoked_at: null },
          data: { revoked_at: new Date() },
        });
        return { action: 'reuse' as const };
      }

      // Happy path: cấp mới + revoke cũ, sliding 30 ngày
      const successor = await tx.refresh_tokens.create({
        data: {
          tenant_id: tenantId,
          user_id: record.user_id,
          token_hash: sha256Hex(successorPlain),
          ip_address: ctx.ip,
          user_agent: ctx.userAgent,
          expires_at: new Date(Date.now() + REFRESH_TTL_MS),
        },
      });
      await tx.refresh_tokens.update({
        where: { id: record.id },
        data: { revoked_at: new Date(), rotated_to: successor.id },
      });
      return { action: 'rotated' as const, user };
    });

    // Pha sau-tx: Redis + issue token
    switch (outcome.action) {
      case 'rotated': {
        await this.redis.set(
          `auth:rotated:${presentedHash}`,
          successorPlain,
          'PX',
          ROTATION_GRACE_MS,
        );
        return this.issueTokens(outcome.user, successorPlain);
      }
      case 'grace': {
        const cached = await this.getRotatedSuccessor(presentedHash);
        if (cached) return this.issueTokens(outcome.user, cached);
        // Redis miss (restart/evict) — không thể trả lại plaintext kế nhiệm → client đăng nhập lại
        throw this.refreshInvalid('AUTH_REFRESH_RETRY');
      }
      case 'reuse':
        throw new AppException({
          code: 'AUTH_TOKEN_REUSE',
          title: 'Phát hiện refresh token bị dùng lại — đã thu hồi toàn bộ phiên',
          status: 401,
        });
      default:
        throw this.refreshInvalid();
    }
  }

  private async getRotatedSuccessor(presentedHash: string): Promise<string | null> {
    const key = `auth:rotated:${presentedHash}`;
    const first = await this.redis.get(key);
    if (first) return first;
    // race: tx kia vừa commit nhưng chưa kịp SET — đợi ngắn rồi thử lại 1 lần
    await new Promise((r) => setTimeout(r, 100));
    return this.redis.get(key);
  }

  // ── Logout (docs/04 §2) ────────────────────────────────────────────────────

  async logout(refreshCookie: string | undefined): Promise<void> {
    const tenantId = refreshCookie && tenantFromRefreshPlain(refreshCookie);
    if (!refreshCookie || !tenantId) return; // idempotent
    const hash = sha256Hex(refreshCookie);
    await withTenant(this.prisma, tenantId, (tx) =>
      tx.refresh_tokens.updateMany({
        where: { token_hash: hash, revoked_at: null },
        data: { revoked_at: new Date() },
      }),
    );
  }

  async logoutAll(user: JwtClaims): Promise<void> {
    await withTenant(this.prisma, user.tnt, (tx) =>
      tx.refresh_tokens.updateMany({
        where: { user_id: user.sub, revoked_at: null },
        data: { revoked_at: new Date() },
      }),
    );
  }

  // ── Forgot / reset password (docs/04: link 30') ────────────────────────────

  async forgotPassword(email: string, tenantId: string | undefined): Promise<void> {
    if (!tenantId) return; // không lộ thông tin — luôn 204 ở controller
    const user = await withTenant(
      this.prisma,
      tenantId,
      (tx) => tx.users.findFirst({ where: { email }, select: { id: true, email: true } }),
      { readOnly: true },
    );
    if (!user) return;

    const token = randomBytes(32).toString('base64url');
    await this.redis.set(
      `auth:pwreset:${sha256Hex(token)}`,
      JSON.stringify({ userId: user.id, tenantId }),
      'EX',
      RESET_TOKEN_TTL_SECONDS,
    );
    await this.mailer.sendPasswordReset(user.email, token);
  }

  async resetPassword(dto: ResetPasswordRequest): Promise<void> {
    this.assertPasswordStrong(dto.new_password);
    const key = `auth:pwreset:${sha256Hex(dto.token)}`;
    const raw = await this.redis.get(key);
    if (!raw) {
      throw new AppException({
        code: 'AUTH_RESET_TOKEN_INVALID',
        title: 'Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn',
        status: 400,
      });
    }
    const { userId, tenantId } = JSON.parse(raw) as { userId: string; tenantId: string };
    const passwordHash = await argon2.hash(dto.new_password, ARGON2_OPTIONS);

    await withTenant(this.prisma, tenantId, async (tx) => {
      await tx.users.update({
        where: { id: userId },
        data: { password_hash: passwordHash, failed_login_count: 0, locked_until: null },
      });
      // AfterPasswordChange (docs/04 §6): revoke toàn bộ phiên
      await tx.refresh_tokens.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: new Date() },
      });
    });
    await this.permissionService.bumpPermissionVersion(userId);
    await this.redis.del(key);
  }

  // ── 2FA TOTP (docs/04 §3) ──────────────────────────────────────────────────

  async twoFaEnable(user: JwtClaims): Promise<{
    secret: string;
    otpauth_url: string;
    backup_codes: string[];
  }> {
    const row = await this.loadUser(user);
    if (row.two_factor_enabled) {
      throw new AppException({
        code: 'AUTH_2FA_ALREADY_ENABLED',
        title: '2FA đã được bật',
        status: 409,
      });
    }
    const enrollment = this.twoFactor.generateEnrollment(row.email);
    await withTenant(this.prisma, user.tnt, (tx) =>
      tx.users.update({
        where: { id: user.sub },
        data: { two_factor_secret: enrollment.encryptedPayload, two_factor_enabled: false },
      }),
    );
    return {
      secret: enrollment.secret,
      otpauth_url: enrollment.otpauthUrl,
      backup_codes: enrollment.backupCodes,
    };
  }

  async twoFaVerify(user: JwtClaims, code: string): Promise<void> {
    const row = await this.loadUser(user);
    if (!row.two_factor_secret) {
      throw new AppException({
        code: 'AUTH_2FA_NOT_ENROLLED',
        title: 'Chưa khởi tạo 2FA — gọi /auth/2fa/enable trước',
        status: 400,
      });
    }
    const verdict = this.twoFactor.verify(row.two_factor_secret, code);
    if (!verdict.ok) {
      throw new AppException({
        code: 'AUTH_2FA_CODE_INVALID',
        title: 'Mã xác thực không đúng',
        status: 400,
      });
    }
    await withTenant(this.prisma, user.tnt, (tx) =>
      tx.users.update({ where: { id: user.sub }, data: { two_factor_enabled: true } }),
    );
  }

  /** Đổi mật khẩu khi đã đăng nhập (task 6.7 S4) — xác minh mật khẩu hiện tại. */
  async changePassword(user: JwtClaims, currentPassword: string, newPassword: string): Promise<void> {
    const row = await this.loadUser(user);
    const ok = await argon2.verify(row.password_hash, currentPassword);
    if (!ok) {
      throw new AppException({
        code: 'AUTH_PASSWORD_INVALID',
        title: 'Mật khẩu hiện tại không đúng',
        status: 400,
      });
    }
    this.assertPasswordStrong(newPassword);
    const passwordHash = await argon2.hash(newPassword, ARGON2_OPTIONS);
    await withTenant(this.prisma, user.tnt, (tx) =>
      tx.users.update({ where: { id: user.sub }, data: { password_hash: passwordHash } }),
    );
  }

  /** Tắt 2FA (task 6.7 S4) — cần TOTP hợp lệ. */
  async twoFaDisable(user: JwtClaims, code: string): Promise<void> {
    const row = await this.loadUser(user);
    if (!row.two_factor_enabled || !row.two_factor_secret) {
      throw new AppException({
        code: 'AUTH_2FA_NOT_ENABLED',
        title: '2FA chưa được bật',
        status: 400,
      });
    }
    const verdict = this.twoFactor.verify(row.two_factor_secret, code);
    if (!verdict.ok) {
      throw new AppException({
        code: 'AUTH_2FA_CODE_INVALID',
        title: 'Mã xác thực không đúng',
        status: 400,
      });
    }
    await withTenant(this.prisma, user.tnt, (tx) =>
      tx.users.update({
        where: { id: user.sub },
        data: { two_factor_enabled: false, two_factor_secret: null },
      }),
    );
  }

  // ── Sessions (docs/04 §2) ──────────────────────────────────────────────────

  async listSessions(user: JwtClaims, currentRefreshCookie?: string): Promise<SessionInfo[]> {
    const currentHash = currentRefreshCookie ? sha256Hex(currentRefreshCookie) : undefined;
    const rows = await withTenant(
      this.prisma,
      user.tnt,
      (tx) =>
        tx.refresh_tokens.findMany({
          where: { user_id: user.sub, revoked_at: null, expires_at: { gt: new Date() } },
          orderBy: { created_at: 'desc' },
        }),
      { readOnly: true },
    );
    return rows.map((row) => ({
      id: row.id,
      ip_address: row.ip_address,
      user_agent: row.user_agent,
      created_at: row.created_at.toISOString(),
      expires_at: row.expires_at.toISOString(),
      current: row.token_hash === currentHash,
    }));
  }

  async revokeSession(user: JwtClaims, sessionId: string): Promise<void> {
    const updated = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.refresh_tokens.updateMany({
        where: { id: sessionId, user_id: user.sub, revoked_at: null },
        data: { revoked_at: new Date() },
      }),
    );
    if (updated.count === 0) {
      throw new AppException({
        code: 'RESOURCE_NOT_FOUND',
        title: 'Phiên không tồn tại',
        status: 404,
      });
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async issueTokens(user: UserRow, refreshPlain: string): Promise<IssuedTokens> {
    const pv = await this.permissionService.getPermissionVersion(user.id);
    const accessToken = this.tokenService.issueAccessToken({
      userId: user.id,
      tenantId: user.tenant_id,
      role: user.default_role,
      scope: [], // TODO(task 2.1): danh sách property ids cho UI
      permissionVersion: pv,
    });
    return {
      body: {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        csrf_token: randomBytes(24).toString('base64url'),
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.default_role,
        },
      },
      refreshCookie: refreshPlain,
    };
  }

  private async registerLoginFailure(
    tenantId: string,
    email: string,
    ip: string,
    user: UserRow | null,
  ): Promise<void> {
    const { accountFails } = await this.throttle.recordFailure(tenantId, email, ip);
    if (!user) return;
    const shouldLock = accountFails >= ACCOUNT_FAIL_LIMIT;
    await withTenant(this.prisma, tenantId, (tx) =>
      tx.users.update({
        where: { id: user.id },
        data: {
          failed_login_count: { increment: 1 },
          ...(shouldLock
            ? { locked_until: new Date(Date.now() + ACCOUNT_LOCK_MINUTES * 60 * 1000) }
            : {}),
        },
      }),
    );
    if (shouldLock) {
      await this.throttle.clearAccountFailures(tenantId, email);
      await this.mailer.sendAccountLockedWarning(email);
    }
  }

  private async loadUser(user: JwtClaims): Promise<UserRow> {
    const row = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.users.findFirst({ where: { id: user.sub } }) as Promise<UserRow | null>,
      { readOnly: true },
    );
    if (!row) {
      throw new AppException({ code: 'AUTH_UNAUTHENTICATED', title: 'Cần đăng nhập', status: 401 });
    }
    return row;
  }

  private assertPasswordStrong(password: string): void {
    if (COMMON_PASSWORDS.has(password.toLowerCase())) {
      throw new AppException({
        code: 'AUTH_WEAK_PASSWORD',
        title: 'Mật khẩu quá phổ biến — chọn mật khẩu khác',
        status: 400,
      });
    }
  }

  private invalidCredentials(): AppException {
    return new AppException({
      code: 'AUTH_INVALID_CREDENTIALS',
      title: 'Email hoặc mật khẩu không đúng',
      status: 401,
    });
  }

  private refreshInvalid(code = 'AUTH_REFRESH_INVALID'): AppException {
    return new AppException({
      code,
      title: 'Phiên đăng nhập không hợp lệ — đăng nhập lại',
      status: 401,
    });
  }
}
