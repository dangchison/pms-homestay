import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  type AssignPropertyRoleRequest,
  type InviteUserRequest,
  type JwtClaims,
  type PropertyRolePermissions,
  type UpdatePropertyRoleRequest,
  type UpdateUserRequest,
  type UserPropertyRoleResponse,
  type UserResponse,
} from '@pms/shared-types';
import { Prisma, type user_property_roles, type users } from '@prisma/client';
import * as argon2 from 'argon2';
import { ALL_PERMISSIONS, type Permission } from '@core/auth/permissions';
import { PermissionService } from '@core/auth/permission.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { SubscriptionService } from '@modules/subscription/subscription.service';
import { AuthService } from '@modules/auth-public/auth.service';

const ARGON2_OPTIONS: argon2.Options = { type: argon2.argon2id };
const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

function toUserResponse(u: users): UserResponse {
  return {
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    phone: u.phone,
    default_role: u.default_role,
    is_active: u.is_active,
    two_factor_enabled: u.two_factor_enabled,
    last_login_at: u.last_login_at ? u.last_login_at.toISOString() : null,
    created_at: u.created_at.toISOString(),
  };
}

function parsePermissions(raw: Prisma.JsonValue): PropertyRolePermissions {
  const obj = (raw ?? {}) as { grant?: unknown; deny?: unknown };
  const asArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return { grant: asArr(obj.grant), deny: asArr(obj.deny) };
}

function toRoleResponse(r: user_property_roles): UserPropertyRoleResponse {
  return {
    id: r.id,
    user_id: r.user_id,
    property_id: r.property_id,
    role: r.role,
    permissions: parsePermissions(r.permissions),
    granted_at: r.granted_at.toISOString(),
  };
}

/**
 * Users & per-property roles (task 6.7 S2, docs/04 §4). users + user_property_roles
 * là bảng tenant-scoped (RLS) → mọi truy vấn qua withTenant. Mời user tái dùng
 * AuthService.forgotPassword để gửi link đặt mật khẩu (best-effort). Mọi thay đổi
 * role/quyền/khoá → bumpPermissionVersion để thu hồi token cache tức thì.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly subscription: SubscriptionService,
    private readonly auth: AuthService,
  ) {}

  async list(user: JwtClaims): Promise<UserResponse[]> {
    const rows = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.users.findMany({ where: { deleted_at: null }, orderBy: { created_at: 'asc' } }),
      { readOnly: true },
    );
    return rows.map(toUserResponse);
  }

  async getById(id: string, user: JwtClaims): Promise<UserResponse> {
    return toUserResponse(await this.loadOrThrow(id, user));
  }

  async invite(dto: InviteUserRequest, user: JwtClaims): Promise<UserResponse> {
    const randomPassword = randomBytes(24).toString('base64url');
    const passwordHash = await argon2.hash(randomPassword, ARGON2_OPTIONS);

    const created = await withTenant(this.prisma, user.tnt, async (tx) => {
      await this.subscription.assertWithinPlanLimitTx(tx, user.tnt, 'user'); // plan-limit (task 4.7)
      try {
        return await tx.users.create({
          data: {
            tenant_id: user.tnt,
            email: dto.email,
            full_name: dto.full_name,
            phone: dto.phone,
            password_hash: passwordHash,
            default_role: dto.default_role,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new AppException({
            code: 'USER_EMAIL_EXISTS',
            title: 'Email đã tồn tại trong tổ chức',
            status: 409,
          });
        }
        throw err;
      }
    });

    // Gửi email đặt mật khẩu (best-effort — không chặn tạo user nếu SMTP lỗi).
    await this.auth.forgotPassword(dto.email, user.tnt).catch((e: unknown) => {
      this.logger.warn(`Không gửi được email mời ${dto.email}: ${String(e)}`);
    });
    return toUserResponse(created);
  }

  async update(id: string, dto: UpdateUserRequest, user: JwtClaims): Promise<UserResponse> {
    if (id === user.sub && (dto.is_active === false || dto.default_role !== undefined)) {
      throw new AppException({
        code: 'CANNOT_MODIFY_SELF',
        title: 'Không thể tự đổi vai trò / vô hiệu hoá chính mình',
        status: 422,
      });
    }
    await this.loadOrThrow(id, user);
    const updated = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.users.update({
        where: { id },
        data: {
          ...(dto.full_name !== undefined ? { full_name: dto.full_name } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.default_role !== undefined ? { default_role: dto.default_role } : {}),
          ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
        },
      }),
    );
    // Đổi role / khoá → thu hồi token cache để có hiệu lực ngay (docs/04 §6).
    if (dto.default_role !== undefined || dto.is_active !== undefined) {
      await this.permissionService.bumpPermissionVersion(id);
    }
    return toUserResponse(updated);
  }

  // ── Per-property roles ───────────────────────────────────────────────────────

  async listPropertyRoles(userId: string, user: JwtClaims): Promise<UserPropertyRoleResponse[]> {
    await this.loadOrThrow(userId, user);
    const rows = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.user_property_roles.findMany({ where: { user_id: userId }, orderBy: { granted_at: 'asc' } }),
      { readOnly: true },
    );
    return rows.map(toRoleResponse);
  }

  async assignPropertyRole(dto: AssignPropertyRoleRequest, user: JwtClaims): Promise<UserPropertyRoleResponse> {
    const permissions = this.validatePermissions(dto.permissions);
    await this.loadOrThrow(dto.user_id, user);

    const row = await withTenant(this.prisma, user.tnt, async (tx) => {
      const prop = await tx.properties.findFirst({ where: { id: dto.property_id }, select: { id: true } });
      if (!prop) {
        throw new AppException({ code: 'PROPERTY_NOT_FOUND', title: 'Cơ sở không tồn tại', status: 404 });
      }
      try {
        return await tx.user_property_roles.create({
          data: {
            tenant_id: user.tnt,
            user_id: dto.user_id,
            property_id: dto.property_id,
            role: dto.role,
            permissions: permissions as Prisma.InputJsonValue,
            granted_by: user.sub,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new AppException({
            code: 'ROLE_ASSIGNMENT_DUPLICATE',
            title: 'User đã có role này tại cơ sở',
            status: 409,
          });
        }
        throw err;
      }
    });
    await this.permissionService.bumpPermissionVersion(dto.user_id);
    return toRoleResponse(row);
  }

  async updatePropertyRole(
    id: string,
    dto: UpdatePropertyRoleRequest,
    user: JwtClaims,
  ): Promise<UserPropertyRoleResponse> {
    const permissions = dto.permissions ? this.validatePermissions(dto.permissions) : undefined;
    const existing = await this.loadRoleOrThrow(id, user);
    const updated = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.user_property_roles.update({
        where: { id },
        data: {
          ...(dto.role !== undefined ? { role: dto.role } : {}),
          ...(permissions !== undefined ? { permissions: permissions as Prisma.InputJsonValue } : {}),
        },
      }),
    );
    await this.permissionService.bumpPermissionVersion(existing.user_id);
    return toRoleResponse(updated);
  }

  async deletePropertyRole(id: string, user: JwtClaims): Promise<void> {
    const existing = await this.loadRoleOrThrow(id, user);
    await withTenant(this.prisma, user.tnt, (tx) =>
      tx.user_property_roles.delete({ where: { id } }),
    );
    await this.permissionService.bumpPermissionVersion(existing.user_id);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private validatePermissions(p: PropertyRolePermissions | undefined): PropertyRolePermissions {
    const value: PropertyRolePermissions = { grant: p?.grant ?? [], deny: p?.deny ?? [] };
    const bad = [...value.grant, ...value.deny].find((k) => !PERMISSION_SET.has(k as Permission));
    if (bad) {
      throw new AppException({
        code: 'INVALID_PERMISSION_KEY',
        title: `Quyền không hợp lệ: ${bad}`,
        status: 400,
      });
    }
    return value;
  }

  private async loadOrThrow(id: string, user: JwtClaims): Promise<users> {
    const row = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.users.findFirst({ where: { id, deleted_at: null } }),
      { readOnly: true },
    );
    if (!row) {
      throw new AppException({ code: 'USER_NOT_FOUND', title: 'Không tìm thấy người dùng', status: 404 });
    }
    return row;
  }

  private async loadRoleOrThrow(id: string, user: JwtClaims): Promise<user_property_roles> {
    const row = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.user_property_roles.findFirst({ where: { id } }),
      { readOnly: true },
    );
    if (!row) {
      throw new AppException({ code: 'ROLE_ASSIGNMENT_NOT_FOUND', title: 'Không tìm thấy phân quyền', status: 404 });
    }
    return row;
  }
}
