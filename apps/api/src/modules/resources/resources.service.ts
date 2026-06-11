import { Injectable } from '@nestjs/common';
import {
  type BookableResourceResponse,
  type CreateWholeResourceRequest,
  type JwtClaims,
  type UpdateResourceRequest,
} from '@pms/shared-types';
import { type Prisma, type bookable_resources } from '@prisma/client';
import { PermissionService } from '@core/auth/permission.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';

type Tx = Prisma.TransactionClient;

function toResourceResponse(r: bookable_resources, roomIds: string[]): BookableResourceResponse {
  return {
    id: r.id,
    property_id: r.property_id,
    type: r.type,
    name: r.name,
    is_active: r.is_active,
    room_ids: roomIds,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

@Injectable()
export class ResourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
  ) {}

  /**
   * ★ Tạo resource ROOM 1:1 + member — gọi TRONG tx tạo room của RoomsService
   * (docs/03 §4.3: tạo room → tự sinh resource type=ROOM). Trả resource id.
   */
  async createRoomResourceTx(
    tx: Tx,
    p: { tenantId: string; propertyId: string; roomId: string; name: string },
  ): Promise<string> {
    const res = await tx.bookable_resources.create({
      data: { tenant_id: p.tenantId, property_id: p.propertyId, type: 'ROOM', name: p.name },
    });
    await tx.resource_members.create({
      data: { tenant_id: p.tenantId, resource_id: res.id, room_id: p.roomId },
    });
    return res.id;
  }

  /** Đổi tên resource ROOM khi room đổi display_name (giữ đồng bộ) — trong tx. */
  async renameRoomResourceTx(tx: Tx, roomId: string, name: string): Promise<void> {
    // resource ROOM nhận diện qua member 1:1 + type=ROOM
    const member = await tx.resource_members.findFirst({ where: { room_id: roomId } });
    if (!member) return;
    await tx.bookable_resources.updateMany({
      where: { id: member.resource_id, type: 'ROOM' },
      data: { name },
    });
  }

  async createWhole(
    dto: CreateWholeResourceRequest,
    user: JwtClaims,
  ): Promise<BookableResourceResponse> {
    await this.loadPropertyOrThrow(dto.property_id, user);
    await this.permissionService.authorizeOnProperty(user, dto.property_id, 'resource.crud');
    const roomIds = [...new Set(dto.room_ids)];

    return withTenant(this.prisma, user.tnt, async (tx) => {
      await this.assertRoomsInProperty(tx, dto.property_id, roomIds);
      const res = await tx.bookable_resources.create({
        data: {
          tenant_id: user.tnt,
          property_id: dto.property_id,
          type: 'WHOLE',
          name: dto.name,
        },
      });
      await tx.resource_members.createMany({
        data: roomIds.map((room_id) => ({
          tenant_id: user.tnt,
          resource_id: res.id,
          room_id,
        })),
      });
      return toResourceResponse(res, roomIds);
    });
  }

  async list(propertyId: string, user: JwtClaims): Promise<BookableResourceResponse[]> {
    await this.loadPropertyOrThrow(propertyId, user);
    await this.permissionService.authorizeOnProperty(user, propertyId, 'property.read');

    return withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const resources = await tx.bookable_resources.findMany({
          where: { property_id: propertyId },
          orderBy: { created_at: 'asc' },
        });
        const members = await tx.resource_members.findMany({
          where: { resource_id: { in: resources.map((r) => r.id) } },
        });
        const byResource = new Map<string, string[]>();
        for (const m of members) {
          const list = byResource.get(m.resource_id) ?? [];
          list.push(m.room_id);
          byResource.set(m.resource_id, list);
        }
        return resources.map((r) => toResourceResponse(r, byResource.get(r.id) ?? []));
      },
      { readOnly: true },
    );
  }

  async getById(id: string, user: JwtClaims): Promise<BookableResourceResponse> {
    const { resource, roomIds } = await this.loadResourceOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, resource.property_id, 'property.read');
    return toResourceResponse(resource, roomIds);
  }

  async update(
    id: string,
    dto: UpdateResourceRequest,
    user: JwtClaims,
  ): Promise<BookableResourceResponse> {
    const { resource } = await this.loadResourceOrThrow(id, user);
    if (resource.type === 'ROOM') {
      throw new AppException({
        code: 'RESOURCE_ROOM_IMMUTABLE',
        title: 'Resource ROOM gắn 1:1 với phòng — sửa qua API phòng',
        status: 422,
      });
    }
    await this.permissionService.authorizeOnProperty(user, resource.property_id, 'resource.crud');
    const newRoomIds = dto.room_ids ? [...new Set(dto.room_ids)] : undefined;

    return withTenant(this.prisma, user.tnt, async (tx) => {
      if (newRoomIds) {
        await this.assertRoomsInProperty(tx, resource.property_id, newRoomIds);
        await tx.resource_members.deleteMany({ where: { resource_id: id } });
        await tx.resource_members.createMany({
          data: newRoomIds.map((room_id) => ({
            tenant_id: user.tnt,
            resource_id: id,
            room_id,
          })),
        });
      }
      const updated = await tx.bookable_resources.update({
        where: { id },
        data: { name: dto.name, is_active: dto.is_active },
      });
      const roomIds =
        newRoomIds ??
        (await tx.resource_members.findMany({ where: { resource_id: id } })).map((m) => m.room_id);
      return toResourceResponse(updated, roomIds);
    });
  }

  async remove(id: string, user: JwtClaims): Promise<void> {
    const { resource } = await this.loadResourceOrThrow(id, user);
    if (resource.type === 'ROOM') {
      throw new AppException({
        code: 'RESOURCE_ROOM_IMMUTABLE',
        title: 'Resource ROOM xoá qua xoá phòng tương ứng',
        status: 422,
      });
    }
    await this.permissionService.authorizeOnProperty(user, resource.property_id, 'resource.crud');
    await withTenant(this.prisma, user.tnt, async (tx) => {
      await tx.resource_members.deleteMany({ where: { resource_id: id } });
      await tx.bookable_resources.update({ where: { id }, data: { deleted_at: new Date() } });
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async assertRoomsInProperty(
    tx: Tx,
    propertyId: string,
    roomIds: string[],
  ): Promise<void> {
    const count = await tx.rooms.count({ where: { id: { in: roomIds }, property_id: propertyId } });
    if (count !== roomIds.length) {
      throw new AppException({
        code: 'RESOURCE_ROOMS_INVALID',
        title: 'Một số phòng không tồn tại hoặc không thuộc cơ sở này',
        status: 422,
      });
    }
  }

  private async loadPropertyOrThrow(propertyId: string, user: JwtClaims): Promise<void> {
    const prop = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.properties.findFirst({ where: { id: propertyId }, select: { id: true } }),
      { readOnly: true },
    );
    if (!prop) {
      throw new AppException({
        code: 'PROPERTY_NOT_FOUND',
        title: 'Cơ sở không tồn tại',
        status: 404,
      });
    }
  }

  private async loadResourceOrThrow(
    id: string,
    user: JwtClaims,
  ): Promise<{ resource: bookable_resources; roomIds: string[] }> {
    const result = await withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const resource = await tx.bookable_resources.findFirst({ where: { id } });
        if (!resource) return null;
        const members = await tx.resource_members.findMany({ where: { resource_id: id } });
        return { resource, roomIds: members.map((m) => m.room_id) };
      },
      { readOnly: true },
    );
    if (!result) {
      throw new AppException({
        code: 'RESOURCE_NOT_FOUND',
        title: 'Resource không tồn tại',
        status: 404,
      });
    }
    return result;
  }
}
