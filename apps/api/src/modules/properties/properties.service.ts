import { Injectable } from '@nestjs/common';
import {
  type CreatePropertyRequest,
  type OffsetPageInfo,
  type PropertyResponse,
  type UpdatePropertyRequest,
} from '@pms/shared-types';
import { Prisma, type properties } from '@prisma/client';
import type { JwtClaims } from '@pms/shared-types';
import { SubscriptionService } from '@modules/subscription/subscription.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { offsetToSkipTake } from '@/shared/dto';

/** Date (DATE column, UTC midnight) → 'YYYY-MM-DD'. */
function toDateOnly(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function toPropertyResponse(p: properties): PropertyResponse {
  return {
    id: p.id,
    name: p.name,
    property_type: p.property_type,
    address_line: p.address_line,
    ward: p.ward,
    district: p.district,
    province: p.province,
    latitude: p.latitude == null ? null : Number(p.latitude),
    longitude: p.longitude == null ? null : Number(p.longitude),
    timezone: p.timezone,
    is_rent_to_rent: p.is_rent_to_rent,
    landlord_name: p.landlord_name,
    landlord_phone: p.landlord_phone,
    rent_to_rent_contract_start: toDateOnly(p.rent_to_rent_contract_start),
    rent_to_rent_contract_end: toDateOnly(p.rent_to_rent_contract_end),
    monthly_landlord_rent_vnd:
      p.monthly_landlord_rent_vnd == null ? null : Number(p.monthly_landlord_rent_vnd),
    landlord_revenue_share_bp: p.landlord_revenue_share_bp,
    police_business_code: p.police_business_code,
    metadata: p.metadata as Record<string, unknown>,
    created_at: p.created_at.toISOString(),
    updated_at: p.updated_at.toISOString(),
  };
}

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly subscription: SubscriptionService,
  ) {}

  async create(dto: CreatePropertyRequest, user: JwtClaims): Promise<PropertyResponse> {
    const row = await withTenant(this.prisma, user.tnt, async (tx) => {
      // Plan-limit (task 4.7): chặn vượt subscription_plans.max_properties (cùng tx → không race)
      await this.subscription.assertWithinPlanLimitTx(tx, user.tnt, 'property');
      return tx.properties.create({ data: this.toCreateData(dto, user.tnt) });
    });
    return toPropertyResponse(row);
  }

  /** Danh sách cơ sở user truy cập được: OWNER → toàn tenant; khác → property có role. */
  async list(
    user: JwtClaims,
    query: { page: number; page_size: number },
  ): Promise<{ data: PropertyResponse[]; page_info: OffsetPageInfo }> {
    const where: Prisma.propertiesWhereInput =
      user.rol === 'OWNER' ? {} : { user_property_roles: { some: { user_id: user.sub } } };
    const { skip, take } = offsetToSkipTake(query);

    const { rows, total } = await withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const [rows, total] = await Promise.all([
          tx.properties.findMany({ where, orderBy: { created_at: 'desc' }, skip, take }),
          tx.properties.count({ where }),
        ]);
        return { rows, total };
      },
      { readOnly: true },
    );

    return {
      data: rows.map(toPropertyResponse),
      page_info: {
        page: query.page,
        page_size: query.page_size,
        total_items: total,
        total_pages: Math.max(1, Math.ceil(total / query.page_size)),
      },
    };
  }

  async getById(id: string, user: JwtClaims): Promise<PropertyResponse> {
    const row = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, id, 'property.read');
    return toPropertyResponse(row);
  }

  async update(
    id: string,
    dto: UpdatePropertyRequest,
    user: JwtClaims,
  ): Promise<PropertyResponse> {
    await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, id, 'property.update');
    const row = await withTenant(this.prisma, user.tnt, (tx) =>
      tx.properties.update({ where: { id }, data: this.toUpdateData(dto) }),
    );
    return toPropertyResponse(row);
  }

  /** Soft-delete (docs/05 §11). Cơ sở còn phòng → 409 (chặn xoá nhầm dữ liệu sống). */
  async remove(id: string, user: JwtClaims): Promise<void> {
    await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, id, 'property.delete');
    await withTenant(this.prisma, user.tnt, async (tx) => {
      const liveRooms = await tx.rooms.count({ where: { property_id: id } });
      if (liveRooms > 0) {
        throw new AppException({
          code: 'PROPERTY_HAS_ROOMS',
          title: 'Không thể xoá cơ sở còn phòng — xoá hoặc chuyển phòng trước',
          status: 409,
        });
      }
      await tx.properties.update({ where: { id }, data: { deleted_at: new Date() } });
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async loadOrThrow(id: string, user: JwtClaims): Promise<properties> {
    const row = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.properties.findFirst({ where: { id } }),
      { readOnly: true },
    );
    if (!row) {
      throw new AppException({
        code: 'PROPERTY_NOT_FOUND',
        title: 'Cơ sở không tồn tại',
        status: 404,
      });
    }
    return row;
  }

  private toCreateData(
    dto: CreatePropertyRequest,
    tenantId: string,
  ): Prisma.propertiesUncheckedCreateInput {
    return {
      tenant_id: tenantId,
      name: dto.name,
      property_type: dto.property_type,
      address_line: dto.address_line,
      province: dto.province,
      ward: dto.ward,
      district: dto.district,
      latitude: dto.latitude,
      longitude: dto.longitude,
      timezone: dto.timezone,
      is_rent_to_rent: dto.is_rent_to_rent,
      landlord_name: dto.landlord_name,
      landlord_phone: dto.landlord_phone,
      rent_to_rent_contract_start: dto.rent_to_rent_contract_start
        ? new Date(dto.rent_to_rent_contract_start)
        : undefined,
      rent_to_rent_contract_end: dto.rent_to_rent_contract_end
        ? new Date(dto.rent_to_rent_contract_end)
        : undefined,
      monthly_landlord_rent_vnd:
        dto.monthly_landlord_rent_vnd == null ? undefined : BigInt(dto.monthly_landlord_rent_vnd),
      landlord_revenue_share_bp: dto.landlord_revenue_share_bp,
      police_business_code: dto.police_business_code,
      ...(dto.metadata !== undefined ? { metadata: dto.metadata as Prisma.InputJsonValue } : {}),
    };
  }

  private toUpdateData(dto: UpdatePropertyRequest): Prisma.propertiesUncheckedUpdateInput {
    return {
      name: dto.name,
      property_type: dto.property_type,
      address_line: dto.address_line,
      province: dto.province,
      ward: dto.ward,
      district: dto.district,
      latitude: dto.latitude,
      longitude: dto.longitude,
      timezone: dto.timezone,
      is_rent_to_rent: dto.is_rent_to_rent,
      landlord_name: dto.landlord_name,
      landlord_phone: dto.landlord_phone,
      rent_to_rent_contract_start: dto.rent_to_rent_contract_start
        ? new Date(dto.rent_to_rent_contract_start)
        : undefined,
      rent_to_rent_contract_end: dto.rent_to_rent_contract_end
        ? new Date(dto.rent_to_rent_contract_end)
        : undefined,
      monthly_landlord_rent_vnd:
        dto.monthly_landlord_rent_vnd == null ? undefined : BigInt(dto.monthly_landlord_rent_vnd),
      landlord_revenue_share_bp: dto.landlord_revenue_share_bp,
      police_business_code: dto.police_business_code,
      ...(dto.metadata !== undefined ? { metadata: dto.metadata as Prisma.InputJsonValue } : {}),
    };
  }
}
