import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  type AssignCleaningTaskRequest,
  type CleaningTaskEventPayload,
  type CleaningTaskResponse,
  type CleaningTaskStatus,
  type CompleteCleaningTaskRequest,
  type CreateCleaningTaskRequest,
  type EventType,
  type JwtClaims,
  type OffsetPageInfo,
  type PresignPhotoRequest,
  type PresignPhotoResponse,
  type RoomHousekeepingEventPayload,
  type StartCleaningTaskRequest,
  type UpdateCleaningTaskRequest,
  type VerifyCleaningTaskRequest,
} from '@pms/shared-types';
import { Prisma, type cleaning_tasks } from '@prisma/client';
import { PermissionService } from '@core/auth/permission.service';
import { AppException } from '@core/http/exceptions/app.exception';
import { PrismaService } from '@core/prisma/prisma.service';
import { StorageService } from '@core/storage/storage.service';
import { OutboxService } from '@core/outbox/outbox.service';
import { withTenant } from '@core/tenancy/with-tenant';
import { offsetToSkipTake } from '@/shared/dto';

/** housekeeping_status của phòng theo trạng thái task (docs/14 §4.1). */
type HousekeepingStatus = 'CLEAN' | 'DIRTY' | 'CLEANING' | 'INSPECTION';

function asStringArray(v: Prisma.JsonValue | null | undefined): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function toCleaningTaskResponse(t: cleaning_tasks): CleaningTaskResponse {
  return {
    id: t.id,
    property_id: t.property_id,
    room_id: t.room_id,
    booking_id: t.booking_id,
    task_type: t.task_type as CleaningTaskResponse['task_type'],
    status: t.status as CleaningTaskStatus,
    assigned_to: t.assigned_to,
    priority: t.priority,
    due_at: t.due_at?.toISOString() ?? null,
    started_at: t.started_at?.toISOString() ?? null,
    completed_at: t.completed_at?.toISOString() ?? null,
    verified_by: t.verified_by,
    verified_at: t.verified_at?.toISOString() ?? null,
    notes: t.notes,
    before_photos: asStringArray(t.before_photos),
    after_photos: asStringArray(t.after_photos),
    version: t.version,
    created_at: t.created_at.toISOString(),
    updated_at: t.updated_at.toISOString(),
  };
}

/**
 * Việc dọn phòng (task 4.1, docs/03 §4.9). Property-scoped: pha-1 RBAC ở controller
 * (`cleaning_task.assign` để điều phối / `cleaning_task.complete` để dọn) + pha-2
 * `authorizeOnProperty` (đây). Auto-sinh khi CHECKED_OUT/switch-resource gọi
 * `createCheckoutTasksTx` TRONG tx của bookings.service. housekeeping_status đổi
 * theo vòng đời: PENDING→DIRTY · IN_PROGRESS→CLEANING · COMPLETED→INSPECTION ·
 * VERIFIED→CLEAN (mỗi lần đổi emit room.housekeeping_changed qua outbox cùng tx).
 */
@Injectable()
export class CleaningService {
  private readonly logger = new Logger(CleaningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly outbox: OutboxService,
    private readonly storage: StorageService,
  ) {}

  // ── Auto-sinh (gọi từ bookings.service TRONG tx) ─────────────────────────────

  /**
   * ★ Sinh task CHECKOUT_CLEAN cho từng phòng thành viên khi booking CHECKED_OUT
   * (hoặc phòng cũ khi switch-resource). Gọi BÊN TRONG withTenant của bookings.service
   * → cùng tx với mutation booking (rollback thì không có task). Mỗi phòng → 1 task
   * PENDING + housekeeping DIRTY + emit room.housekeeping_changed.
   */
  async createCheckoutTasksTx(
    tx: Prisma.TransactionClient,
    params: { tenantId: string; propertyId: string; bookingId: string; roomIds: string[] },
  ): Promise<void> {
    for (const roomId of params.roomIds) {
      await tx.cleaning_tasks.create({
        data: {
          tenant_id: params.tenantId,
          property_id: params.propertyId,
          room_id: roomId,
          booking_id: params.bookingId,
          task_type: 'CHECKOUT_CLEAN',
          status: 'PENDING',
        } satisfies Prisma.cleaning_tasksUncheckedCreateInput,
      });
      await this.setRoomHousekeepingTx(tx, params.propertyId, roomId, 'DIRTY');
    }
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  async create(dto: CreateCleaningTaskRequest, user: JwtClaims): Promise<CleaningTaskResponse> {
    await this.permissionService.authorizeOnProperty(user, dto.property_id, 'cleaning_task.assign');
    await this.assertRoomInProperty(dto.room_id, dto.property_id, user);

    const row = await withTenant(this.prisma, user.tnt, async (tx) => {
      const created = await tx.cleaning_tasks.create({
        data: {
          tenant_id: user.tnt,
          property_id: dto.property_id,
          room_id: dto.room_id,
          booking_id: dto.booking_id ?? null,
          task_type: dto.task_type,
          assigned_to: dto.assigned_to ?? null,
          priority: dto.priority,
          due_at: dto.due_at ? new Date(dto.due_at) : null,
          notes: dto.notes,
        } satisfies Prisma.cleaning_tasksUncheckedCreateInput,
      });
      if (created.assigned_to) await this.emitCleaning(tx, 'cleaning_task.assigned', created);
      return created;
    });
    return toCleaningTaskResponse(row);
  }

  async list(
    propertyId: string,
    user: JwtClaims,
    query: {
      page: number;
      page_size: number;
      status?: CleaningTaskStatus;
      assigned_to?: string;
      room_id?: string;
    },
  ): Promise<{ data: CleaningTaskResponse[]; page_info: OffsetPageInfo }> {
    await this.permissionService.authorizeOnProperty(user, propertyId, 'cleaning_task.complete');
    const { skip, take } = offsetToSkipTake(query);
    const where: Prisma.cleaning_tasksWhereInput = {
      property_id: propertyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.assigned_to ? { assigned_to: query.assigned_to } : {}),
      ...(query.room_id ? { room_id: query.room_id } : {}),
    };

    const { rows, total } = await withTenant(
      this.prisma,
      user.tnt,
      async (tx) => {
        const [rows, total] = await Promise.all([
          tx.cleaning_tasks.findMany({
            where,
            orderBy: [{ priority: 'desc' }, { created_at: 'desc' }],
            skip,
            take,
          }),
          tx.cleaning_tasks.count({ where }),
        ]);
        return { rows, total };
      },
      { readOnly: true },
    );

    return {
      data: rows.map(toCleaningTaskResponse),
      page_info: {
        page: query.page,
        page_size: query.page_size,
        total_items: total,
        total_pages: Math.max(1, Math.ceil(total / query.page_size)),
      },
    };
  }

  async getById(id: string, user: JwtClaims): Promise<CleaningTaskResponse> {
    const task = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, task.property_id, 'cleaning_task.complete');
    return toCleaningTaskResponse(task);
  }

  /** PATCH (If-Match) — chỉ trường điều phối (assignee/priority/due_at/notes). */
  async update(
    id: string,
    expectedVersion: number,
    dto: UpdateCleaningTaskRequest,
    user: JwtClaims,
  ): Promise<CleaningTaskResponse> {
    const task = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, task.property_id, 'cleaning_task.assign');

    const updated = await withTenant(this.prisma, user.tnt, async (tx) => {
      const result = await tx.cleaning_tasks.updateMany({
        where: { id, version: expectedVersion },
        data: {
          assigned_to: dto.assigned_to,
          priority: dto.priority,
          due_at: dto.due_at === undefined ? undefined : dto.due_at ? new Date(dto.due_at) : null,
          notes: dto.notes,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw this.versionConflict();
      return tx.cleaning_tasks.findFirstOrThrow({ where: { id } });
    });
    return toCleaningTaskResponse(updated);
  }

  // ── Vòng đời ──────────────────────────────────────────────────────────────────

  /** Gán/đổi người dọn (PENDING/IN_PROGRESS). Emit cleaning_task.assigned. */
  async assign(
    id: string,
    dto: AssignCleaningTaskRequest,
    user: JwtClaims,
  ): Promise<CleaningTaskResponse> {
    const task = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, task.property_id, 'cleaning_task.assign');
    this.assertStatus(task.status, ['PENDING', 'IN_PROGRESS']);

    const updated = await withTenant(this.prisma, user.tnt, async (tx) => {
      const result = await tx.cleaning_tasks.updateMany({
        where: { id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        data: { assigned_to: dto.assigned_to, version: { increment: 1 } },
      });
      if (result.count === 0) throw this.statusRace();
      const fresh = await tx.cleaning_tasks.findFirstOrThrow({ where: { id } });
      await this.emitCleaning(tx, 'cleaning_task.assigned', fresh);
      return fresh;
    });
    return toCleaningTaskResponse(updated);
  }

  /** Bắt đầu dọn (PENDING→IN_PROGRESS): đính ảnh "trước", phòng → CLEANING. */
  async start(
    id: string,
    dto: StartCleaningTaskRequest,
    user: JwtClaims,
  ): Promise<CleaningTaskResponse> {
    const task = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, task.property_id, 'cleaning_task.complete');
    this.assertStatus(task.status, ['PENDING']);
    const photos = this.validatePhotoKeys(dto.before_photos, user.tnt, id);

    const updated = await withTenant(this.prisma, user.tnt, async (tx) => {
      const result = await tx.cleaning_tasks.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'IN_PROGRESS',
          started_at: new Date(),
          ...(photos.length ? { before_photos: photos as Prisma.InputJsonValue } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw this.statusRace();
      await this.setRoomHousekeepingTx(tx, task.property_id, task.room_id, 'CLEANING');
      return tx.cleaning_tasks.findFirstOrThrow({ where: { id } });
    });
    return toCleaningTaskResponse(updated);
  }

  /** Hoàn tất (IN_PROGRESS→COMPLETED): đính ảnh "sau", phòng → INSPECTION. */
  async complete(
    id: string,
    dto: CompleteCleaningTaskRequest,
    user: JwtClaims,
  ): Promise<CleaningTaskResponse> {
    const task = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, task.property_id, 'cleaning_task.complete');
    this.assertStatus(task.status, ['IN_PROGRESS']);
    const photos = this.validatePhotoKeys(dto.after_photos, user.tnt, id);

    const updated = await withTenant(this.prisma, user.tnt, async (tx) => {
      const result = await tx.cleaning_tasks.updateMany({
        where: { id, status: 'IN_PROGRESS' },
        data: {
          status: 'COMPLETED',
          completed_at: new Date(),
          ...(photos.length ? { after_photos: photos as Prisma.InputJsonValue } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw this.statusRace();
      await this.setRoomHousekeepingTx(tx, task.property_id, task.room_id, 'INSPECTION');
      const fresh = await tx.cleaning_tasks.findFirstOrThrow({ where: { id } });
      await this.emitCleaning(tx, 'cleaning_task.completed', fresh);
      return fresh;
    });
    return toCleaningTaskResponse(updated);
  }

  /** Nghiệm thu (COMPLETED→VERIFIED): phòng → CLEAN. */
  async verify(
    id: string,
    dto: VerifyCleaningTaskRequest,
    user: JwtClaims,
  ): Promise<CleaningTaskResponse> {
    const task = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, task.property_id, 'cleaning_task.assign');
    this.assertStatus(task.status, ['COMPLETED']);

    const updated = await withTenant(this.prisma, user.tnt, async (tx) => {
      const result = await tx.cleaning_tasks.updateMany({
        where: { id, status: 'COMPLETED' },
        data: {
          status: 'VERIFIED',
          verified_by: user.sub,
          verified_at: new Date(),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw this.statusRace();
      await this.setRoomHousekeepingTx(tx, task.property_id, task.room_id, 'CLEAN');
      return tx.cleaning_tasks.findFirstOrThrow({ where: { id } });
    });
    return toCleaningTaskResponse(updated);
  }

  /** Huỷ (PENDING/IN_PROGRESS → CANCELLED). Không đổi housekeeping (giữ nguyên hiện trạng). */
  async cancel(id: string, reason: string, user: JwtClaims): Promise<CleaningTaskResponse> {
    const task = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, task.property_id, 'cleaning_task.assign');
    this.assertStatus(task.status, ['PENDING', 'IN_PROGRESS']);

    const updated = await withTenant(this.prisma, user.tnt, async (tx) => {
      const result = await tx.cleaning_tasks.updateMany({
        where: { id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        data: {
          status: 'CANCELLED',
          notes: task.notes ? `${task.notes}\n[Huỷ] ${reason}` : `[Huỷ] ${reason}`,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw this.statusRace();
      return tx.cleaning_tasks.findFirstOrThrow({ where: { id } });
    });
    return toCleaningTaskResponse(updated);
  }

  // ── Ảnh (pre-signed S3) ───────────────────────────────────────────────────────

  /** Cấp URL PUT pre-signed cho 1 ảnh; key gắn vào before/after khi start/complete. */
  async presignPhoto(
    id: string,
    dto: PresignPhotoRequest,
    user: JwtClaims,
  ): Promise<PresignPhotoResponse> {
    const task = await this.loadOrThrow(id, user);
    await this.permissionService.authorizeOnProperty(user, task.property_id, 'cleaning_task.complete');
    const key = `cleaning/${user.tnt}/${id}/${dto.phase}/${randomUUID()}`;
    return this.storage.presignPut(key, dto.content_type);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────────

  private setRoomHousekeepingTx(
    tx: Prisma.TransactionClient,
    propertyId: string,
    roomId: string,
    status: HousekeepingStatus,
  ): Promise<void> {
    return tx.rooms
      .update({ where: { id: roomId }, data: { housekeeping_status: status, version: { increment: 1 } } })
      .then(() => {
        const payload: RoomHousekeepingEventPayload = {
          property_id: propertyId,
          room_id: roomId,
          housekeeping_status: status,
        };
        return this.outbox.publish(tx, {
          event_type: 'room.housekeeping_changed',
          aggregate_type: 'room',
          aggregate_id: roomId,
          payload,
        });
      });
  }

  /** Emit cleaning_task.* cùng tx (docs/10 §3). property_id để filter SSE theo cơ sở. */
  private emitCleaning(
    tx: Prisma.TransactionClient,
    eventType: Extract<EventType, `cleaning_task.${string}`>,
    task: cleaning_tasks,
  ): Promise<void> {
    const payload: CleaningTaskEventPayload = {
      cleaning_task_id: task.id,
      property_id: task.property_id,
      room_id: task.room_id,
    };
    if (task.booking_id) payload.booking_id = task.booking_id;
    if (task.assigned_to) payload.assigned_to = task.assigned_to;
    return this.outbox.publish(tx, {
      event_type: eventType,
      aggregate_type: 'cleaning_task',
      aggregate_id: task.id,
      payload,
    });
  }

  /** Key phải do chính task này sinh (chống ghi đường dẫn tuỳ ý từ client). */
  private validatePhotoKeys(keys: string[] | undefined, tenantId: string, taskId: string): string[] {
    if (!keys?.length) return [];
    const prefix = `cleaning/${tenantId}/${taskId}/`;
    for (const k of keys) {
      if (!k.startsWith(prefix)) {
        throw new AppException({
          code: 'CLEANING_PHOTO_INVALID_KEY',
          title: 'Ảnh không thuộc task này — xin presign lại',
          status: 422,
        });
      }
    }
    return keys;
  }

  private assertStatus(current: string, allowed: CleaningTaskStatus[]): void {
    if (!allowed.includes(current as CleaningTaskStatus)) {
      throw new AppException({
        code: 'CLEANING_TASK_INVALID_STATUS',
        title: `Task đang ${current} — không thực hiện được thao tác này`,
        status: 422,
      });
    }
  }

  private statusRace(): AppException {
    return new AppException({
      code: 'CLEANING_TASK_INVALID_STATUS',
      title: 'Task đã đổi trạng thái — tải lại rồi thử lại',
      status: 409,
    });
  }

  private versionConflict(): AppException {
    return new AppException({
      code: 'VERSION_CONFLICT',
      title: 'Task đã bị sửa bởi người khác — tải lại rồi thử lại',
      status: 409,
    });
  }

  private async assertRoomInProperty(
    roomId: string,
    propertyId: string,
    user: JwtClaims,
  ): Promise<void> {
    const room = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.rooms.findFirst({ where: { id: roomId }, select: { property_id: true } }),
      { readOnly: true },
    );
    if (!room) {
      throw new AppException({ code: 'ROOM_NOT_FOUND', title: 'Phòng không tồn tại', status: 404 });
    }
    if (room.property_id !== propertyId) {
      throw new AppException({
        code: 'ROOM_PROPERTY_MISMATCH',
        title: 'Phòng không thuộc cơ sở này',
        status: 422,
      });
    }
  }

  private async loadOrThrow(id: string, user: JwtClaims): Promise<cleaning_tasks> {
    const task = await withTenant(
      this.prisma,
      user.tnt,
      (tx) => tx.cleaning_tasks.findFirst({ where: { id } }),
      { readOnly: true },
    );
    if (!task) {
      throw new AppException({
        code: 'CLEANING_TASK_NOT_FOUND',
        title: 'Việc dọn phòng không tồn tại',
        status: 404,
      });
    }
    return task;
  }
}
