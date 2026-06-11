import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** Phòng thành viên của một resource + buffer dọn phòng của nó. */
export interface MemberRoom {
  room_id: string;
  buffer_minutes: number;
}

/** Một hàng occupancy đang chặn (kết quả pre-check / availability). */
export interface OccupancyConflict {
  id: string;
  room_id: string;
  booking_id: string | null;
  block_id: string | null;
  start_at: Date;
  end_at: Date;
}

interface RawConflict {
  id: string;
  room_id: string;
  booking_id: string | null;
  block_id: string | null;
  start_at: Date;
  end_at: Date;
}

/**
 * ★ OccupancyService — CHOKE-POINT DUY NHẤT sinh/xoá `room_occupancy`
 * (docs/06, [ADR-0006]). Cấm module khác tự INSERT/DELETE bảng này.
 *
 * Mô hình presence-based: hàng tồn tại ⇔ khoảng thời gian bị chặn (không có cột
 * status → không drift). EXCLUDE `room_occupancy_no_overlap` là hàng phòng thủ
 * cuối — vi phạm ném 23P01 → PgErrorFilter map 409 BOOKING_OVERLAP.
 *
 * Mọi method nhận `tx` tường minh và PHẢI chạy trong withTenant (GUC tenant +
 * RLS đã set). `period` là tstzrange (Prisma Unsupported) nên dùng raw SQL.
 */
@Injectable()
export class OccupancyService {
  /** Phòng vật lý mà resource chiếm + buffer mỗi phòng (resource_members ⨝ rooms). */
  async memberRooms(tx: Tx, resourceId: string): Promise<MemberRoom[]> {
    const rows = await tx.$queryRaw<{ room_id: string; buffer_minutes: number }[]>(Prisma.sql`
      SELECT rm.room_id::text AS room_id, r.buffer_minutes
      FROM resource_members rm
      JOIN rooms r ON r.id = rm.room_id AND r.deleted_at IS NULL
      WHERE rm.resource_id = ${resourceId}::uuid
      ORDER BY rm.room_id
    `);
    return rows.map((r) => ({ room_id: r.room_id, buffer_minutes: Number(r.buffer_minutes) }));
  }

  /**
   * Lớp 1 — pre-check (docs/06 §5): các hàng occupancy chồng khoảng [from, to)
   * trên tập phòng. Dùng cho availability + báo lỗi đẹp trước khi đụng EXCLUDE.
   */
  async findOverlaps(tx: Tx, roomIds: string[], from: Date, to: Date): Promise<OccupancyConflict[]> {
    if (roomIds.length === 0) return [];
    const rows = await tx.$queryRaw<RawConflict[]>(Prisma.sql`
      SELECT id::text AS id,
             room_id::text AS room_id,
             booking_id::text AS booking_id,
             block_id::text AS block_id,
             lower(period) AS start_at,
             upper(period) AS end_at
      FROM room_occupancy
      WHERE room_id IN (${Prisma.join(roomIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND period && tstzrange(${from}, ${to}, '[)')
      ORDER BY lower(period)
    `);
    return rows.map((r) => ({
      id: r.id,
      room_id: r.room_id,
      booking_id: r.booking_id,
      block_id: r.block_id,
      start_at: r.start_at,
      end_at: r.end_at,
    }));
  }

  /**
   * Lớp 3 — advisory lock (docs/06 §3): serialize các request đụng cùng phòng,
   * lock theo thứ tự ĐÃ SORT để tránh deadlock WHOLE↔ROOM. Tự release khi tx kết
   * thúc. Là tối ưu UX — bỏ lock hệ thống vẫn ĐÚNG nhờ EXCLUDE.
   */
  async lockRooms(tx: Tx, roomIds: string[]): Promise<void> {
    for (const roomId of [...roomIds].sort()) {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${roomId}::text, 0))`,
      );
    }
  }

  /**
   * Sinh occupancy cho booking — mỗi phòng thành viên 1 hàng, buffer áp Ở ĐÂY:
   * `period = [check_in − buffer, check_out + buffer)` theo buffer từng phòng
   * (booking lưu giờ thực, occupancy lưu khoảng chặn). EXCLUDE có thể ném 23P01.
   */
  async insertForBooking(
    tx: Tx,
    p: { tenantId: string; bookingId: string; members: MemberRoom[]; checkIn: Date; checkOut: Date },
  ): Promise<void> {
    for (const m of p.members) {
      const bufferMs = m.buffer_minutes * 60_000;
      const start = new Date(p.checkIn.getTime() - bufferMs);
      const end = new Date(p.checkOut.getTime() + bufferMs);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO room_occupancy (tenant_id, room_id, booking_id, period)
        VALUES (${p.tenantId}::uuid, ${m.room_id}::uuid, ${p.bookingId}::uuid,
                tstzrange(${start}, ${end}, '[)'))
      `);
    }
  }

  /**
   * Sinh occupancy cho room_block — 1 hàng, KHÔNG buffer (khoảng chặn = đúng
   * start_at..end_at). EXCLUDE chung chặn xung đột block↔booking và block↔block.
   */
  async insertForBlock(
    tx: Tx,
    p: { tenantId: string; blockId: string; roomId: string; startAt: Date; endAt: Date },
  ): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO room_occupancy (tenant_id, room_id, block_id, period)
      VALUES (${p.tenantId}::uuid, ${p.roomId}::uuid, ${p.blockId}::uuid,
              tstzrange(${p.startAt}, ${p.endAt}, '[)'))
    `);
  }

  /** Booking về terminal (CANCELLED/NO_SHOW/CHECKED_OUT) hoặc đổi ngày/resource. */
  async deleteForBooking(tx: Tx, bookingId: string): Promise<number> {
    return tx.$executeRaw(
      Prisma.sql`DELETE FROM room_occupancy WHERE booking_id = ${bookingId}::uuid`,
    );
  }

  /** Xoá block → giải phóng khoảng chặn (cũng tự cascade qua FK, đây là choke-point). */
  async deleteForBlock(tx: Tx, blockId: string): Promise<number> {
    return tx.$executeRaw(Prisma.sql`DELETE FROM room_occupancy WHERE block_id = ${blockId}::uuid`);
  }
}
