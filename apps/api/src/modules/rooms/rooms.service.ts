import { Injectable } from '@nestjs/common';
import {
  type CreateRoomRequest,
  type JwtClaims,
  type RoomResponse,
  type UpdateRoomRequest,
} from '@pms/shared-types';
import { Prisma, type rooms } from '@prisma/client';
import { ResourcesService } from '@modules/resources/resources.service';
import { SubscriptionService } from '@modules/subscription/subscription.service';
import { PermissionService } from '@core/auth/permission.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';

function toRoomResponse(r: rooms): RoomResponse {
  return {
    id: r.id,
    property_id: r.property_id,
    room_number: r.room_number,
    display_name: r.display_name,
    description: r.description,
    housekeeping_status: r.housekeeping_status,
    capacity_adults: r.capacity_adults,
    capacity_children: r.capacity_children,
    size_sqm: r.size_sqm == null ? null : Number(r.size_sqm),
    amenities: (r.amenities as string[] | null) ?? [],
    photos: (r.photos as string[] | null) ?? [],
    is_active: r.is_active,
    buffer_minutes: r.buffer_minutes,
    notes: r.notes,
    version: r.version,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly resources: ResourcesService,
    private readonly subscription: SubscriptionService,
  ) {}

  /** Tạo phòng → TỰ SINH resource type=ROOM + member 1:1 trong cùng tx (ADR-0006). */
  async create(dto: CreateRoomRequest, user: JwtClaims): Promise<RoomResponse> {
    await this.assertPropertyExists(dto.property_id, user);
    await this.permissionService.authorizeOnProperty(user, dto.property_id, 'room.crud');

    const row = await withTenant(this.prisma, user.tnt, async (tx) => {
      // Plan-limit (task 4.7): chặn vượt subscription_plans.max_rooms (cùng tx → không race)
      await this.subscription.assertWithinPlanLimitTx(tx, user.tnt, 'room');
      const room = await tx.rooms.create({ data: this.toCreateData(dto, user.tnt) });
      await this.resources.createRoomResourceTx(tx, {
        tenantId: user.tnt,
        propertyId: dto.property_id,
        roomId: room.id,
        name: dto.display_name ?? dto.room_number,
      });
      return room;
    });
    return toRoomResponse(row);
  }

  async list(propertyId: string, user: JwtClaims): Promise<RoomResponse[]> {
    await this.assertPropertyExists(propertyId, user);
    await this.permissionService.authorizeOnProperty(user, propertyId, 'property.read');
    const rows = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.rooms.findMany({ where: { property_id: propertyId }, orderBy: { room_number: 'asc' } }),
      { readOnly: true },
    );
    return rows.map(toRoomResponse);
  }

  async getById(id: string, user: JwtClaims): Promise<RoomResponse> {
    const room = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, room.property_id, 'property.read');
    return toRoomResponse(room);
  }

  /** PATCH room cần If-Match = version (docs/05 §4.5); lệch → 409 VERSION_CONFLICT. */
  async update(
    id: string,
    expectedVersion: number,
    dto: UpdateRoomRequest,
    user: JwtClaims,
  ): Promise<RoomResponse> {
    const room = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, room.property_id, 'room.crud');

    const updated = await withTenant(this.prisma, user.tnt, async (tx) => {
      const result = await tx.rooms.updateMany({
        where: { id, version: expectedVersion },
        data: this.toUpdateData(dto),
      });
      if (result.count === 0) {
        throw new AppException({
          code: 'VERSION_CONFLICT',
          title: 'Phòng đã bị sửa bởi người khác — tải lại rồi thử lại',
          status: 409,
        });
      }
      const fresh = await tx.rooms.findFirstOrThrow({ where: { id } });
      // Giữ tên resource ROOM đồng bộ khi đổi display_name
      if (dto.display_name !== undefined) {
        await this.resources.renameRoomResourceTx(tx, id, fresh.display_name ?? fresh.room_number);
      }
      return fresh;
    });
    return toRoomResponse(updated);
  }

  /** Soft-delete phòng (docs/05 §11): chặn nếu còn occupancy; gỡ resource ROOM + members. */
  async remove(id: string, user: JwtClaims): Promise<void> {
    const room = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, room.property_id, 'room.crud');

    await withTenant(this.prisma, user.tnt, async (tx) => {
      const occupied = await tx.room_occupancy.count({ where: { room_id: id } });
      if (occupied > 0) {
        throw new AppException({
          code: 'ROOM_HAS_OCCUPANCY',
          title: 'Phòng còn lịch đặt/chặn — không thể xoá',
          status: 409,
        });
      }
      const members = await tx.resource_members.findMany({ where: { room_id: id } });
      const resourceIds = members.map((m) => m.resource_id);
      // soft-delete resource ROOM 1:1; gỡ phòng khỏi mọi resource (kể cả WHOLE)
      await tx.bookable_resources.updateMany({
        where: { id: { in: resourceIds }, type: 'ROOM' },
        data: { deleted_at: new Date() },
      });
      await tx.resource_members.deleteMany({ where: { room_id: id } });
      await tx.rooms.update({ where: { id }, data: { deleted_at: new Date() } });
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async assertPropertyExists(propertyId: string, user: JwtClaims): Promise<void> {
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

  private async loadOrThrow(id: string, user: JwtClaims): Promise<rooms> {
    const room = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.rooms.findFirst({ where: { id } }),
      { readOnly: true },
    );
    if (!room) {
      throw new AppException({ code: 'ROOM_NOT_FOUND', title: 'Phòng không tồn tại', status: 404 });
    }
    return room;
  }

  private toCreateData(dto: CreateRoomRequest, tenantId: string): Prisma.roomsUncheckedCreateInput {
    return {
      tenant_id: tenantId,
      property_id: dto.property_id,
      room_number: dto.room_number,
      display_name: dto.display_name,
      description: dto.description,
      capacity_adults: dto.capacity_adults,
      capacity_children: dto.capacity_children,
      size_sqm: dto.size_sqm,
      buffer_minutes: dto.buffer_minutes,
      notes: dto.notes,
      ...(dto.amenities !== undefined ? { amenities: dto.amenities as Prisma.InputJsonValue } : {}),
      ...(dto.photos !== undefined ? { photos: dto.photos as Prisma.InputJsonValue } : {}),
    };
  }

  private toUpdateData(dto: UpdateRoomRequest): Prisma.roomsUncheckedUpdateInput {
    return {
      display_name: dto.display_name,
      description: dto.description,
      housekeeping_status: dto.housekeeping_status,
      capacity_adults: dto.capacity_adults,
      capacity_children: dto.capacity_children,
      size_sqm: dto.size_sqm,
      is_active: dto.is_active,
      buffer_minutes: dto.buffer_minutes,
      notes: dto.notes,
      ...(dto.amenities !== undefined ? { amenities: dto.amenities as Prisma.InputJsonValue } : {}),
      ...(dto.photos !== undefined ? { photos: dto.photos as Prisma.InputJsonValue } : {}),
      version: { increment: 1 },
    };
  }
}
