import { Injectable } from '@nestjs/common';
import {
  type CreateRoomBlockRequest,
  type JwtClaims,
  type RoomBlockEventPayload,
  type RoomBlockResponse,
} from '@pms/shared-types';
import { type room_blocks } from '@prisma/client';
import { PermissionService } from '@core/auth/permission.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { OutboxService } from '@core/outbox/outbox.service';
import { PrismaService } from '@core/prisma/prisma.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { OccupancyService } from '@modules/occupancy/occupancy.service';

function toBlockResponse(b: room_blocks): RoomBlockResponse {
  return {
    id: b.id,
    room_id: b.room_id,
    start_at: b.start_at.toISOString(),
    end_at: b.end_at.toISOString(),
    reason: b.reason,
    created_by: b.created_by,
    created_at: b.created_at.toISOString(),
  };
}

/**
 * Chặn phòng (bảo trì/owner dùng). Block ghi vào room_occupancy cùng tx →
 * EXCLUDE chung tự chặn xung đột với booking và block khác (docs/06 §2).
 */
@Injectable()
export class RoomBlocksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly occupancy: OccupancyService,
    private readonly outbox: OutboxService,
  ) {}

  async create(dto: CreateRoomBlockRequest, user: JwtClaims): Promise<RoomBlockResponse> {
    const room = await this.loadRoomOrThrow(dto.room_id, user);
    await this.permissionService.authorizeOnProperty(user, room.property_id, 'room.crud');
    const startAt = new Date(dto.start_at);
    const endAt = new Date(dto.end_at);

    const block = await withTenant(this.prisma, user.tnt, async (tx) => {
      await this.occupancy.lockRooms(tx, [dto.room_id]);
      // Lớp 1 pre-check — báo 409 đẹp trước khi đụng EXCLUDE
      const conflicts = await this.occupancy.findOverlaps(tx, [dto.room_id], startAt, endAt);
      if (conflicts.length > 0) {
        throw new AppException({
          code: 'BOOKING_OVERLAP',
          title: 'Phòng đã có lịch đặt/chặn trong khoảng này',
          status: 409,
          detail: `${conflicts.length} khoảng chồng lấn`,
        });
      }
      const created = await tx.room_blocks.create({
        data: {
          tenant_id: user.tnt,
          room_id: dto.room_id,
          start_at: startAt,
          end_at: endAt,
          reason: dto.reason,
          created_by: user.sub,
        },
      });
      // EXCLUDE là chốt chặn cuối — vi phạm ném 23P01 → PgErrorFilter 409
      await this.occupancy.insertForBlock(tx, {
        tenantId: user.tnt,
        blockId: created.id,
        roomId: dto.room_id,
        startAt,
        endAt,
      });
      await this.outbox.publish(tx, {
        event_type: 'room.blocked',
        aggregate_type: 'room',
        aggregate_id: created.id,
        payload: {
          property_id: room.property_id,
          room_id: dto.room_id,
          block_id: created.id,
        } satisfies RoomBlockEventPayload,
      });
      return created;
    });
    return toBlockResponse(block);
  }

  async list(roomId: string, user: JwtClaims): Promise<RoomBlockResponse[]> {
    const room = await this.loadRoomOrThrow(roomId, user);
    await this.permissionService.authorizeOnProperty(user, room.property_id, 'property.read');
    const rows = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.room_blocks.findMany({ where: { room_id: roomId }, orderBy: { start_at: 'asc' } }),
      { readOnly: true },
    );
    return rows.map(toBlockResponse);
  }

  async remove(id: string, user: JwtClaims): Promise<void> {
    const block = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.room_blocks.findFirst({ where: { id } }),
      { readOnly: true },
    );
    if (!block) {
      throw new AppException({ code: 'BLOCK_NOT_FOUND', title: 'Block không tồn tại', status: 404 });
    }
    const room = await this.loadRoomOrThrow(block.room_id, user);
    await this.permissionService.authorizeOnProperty(user, room.property_id, 'room.crud');

    await withTenant(this.prisma, user.tnt, async (tx) => {
      // Choke-point: xoá occupancy trước (FK cascade là backstop), rồi xoá block
      await this.occupancy.deleteForBlock(tx, id);
      await tx.room_blocks.delete({ where: { id } });
      await this.outbox.publish(tx, {
        event_type: 'room.unblocked',
        aggregate_type: 'room',
        aggregate_id: id,
        payload: {
          property_id: room.property_id,
          room_id: block.room_id,
          block_id: id,
        } satisfies RoomBlockEventPayload,
      });
    });
  }

  private async loadRoomOrThrow(
    roomId: string,
    user: JwtClaims,
  ): Promise<{ property_id: string }> {
    const room = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.rooms.findFirst({ where: { id: roomId }, select: { property_id: true } }),
      { readOnly: true },
    );
    if (!room) {
      throw new AppException({ code: 'ROOM_NOT_FOUND', title: 'Phòng không tồn tại', status: 404 });
    }
    return room;
  }
}
