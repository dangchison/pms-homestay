import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@core/tenancy/with-tenant';
import { OccupancyService } from '@modules/occupancy/occupancy.service';

/**
 * ★ Acceptance task 2.1 + docs/06 §8: chống overbooking ở TẦNG DB qua EXCLUDE
 * trên room_occupancy (presence-based, ADR-0006). Chạy bằng app_user (RLS thật)
 * qua OccupancyService — choke-point duy nhất.
 *
 * Fixtures (admin/postgres bypass RLS): 1 tenant, 1 property, 2 phòng
 * (A buffer 0, B buffer 30'), resource ROOM_A/ROOM_B + WHOLE (A+B).
 */

const OVERLAP_RE = /23P01|exclusion|overlap|conflicting key/i;
/** Mốc giờ UTC cố định trong ngày test (đổi h → instant khác nhau). */
const at = (hour: number): Date => new Date(Date.UTC(2027, 2, 10, hour, 0, 0));

describe('OccupancyService + EXCLUDE room_occupancy (task 2.1)', () => {
  const occ = new OccupancyService();
  let admin: Client;
  let prisma: PrismaClient;
  let tenantId: string;
  let roomA: string;
  let roomB: string;
  let resWhole: string;
  let resRoomA: string;

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();
    prisma = new PrismaClient();
    await prisma.$connect();

    tenantId = (
      await admin.query(
        `INSERT INTO tenants (slug, display_name, status) VALUES ($1, 'Occ Test', 'ACTIVE') RETURNING id`,
        [`occ-${process.pid}${Date.now() % 100000}`],
      )
    ).rows[0].id;

    const propertyId = (
      await admin.query(
        `INSERT INTO properties (tenant_id, name, property_type, address_line, province)
         VALUES ($1, 'P', 'HOMESTAY', 'addr', 'Đà Nẵng') RETURNING id`,
        [tenantId],
      )
    ).rows[0].id;

    const insRoom = async (num: string, buffer: number): Promise<string> =>
      (
        await admin.query(
          `INSERT INTO rooms (tenant_id, property_id, room_number, buffer_minutes)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [tenantId, propertyId, num, buffer],
        )
      ).rows[0].id;
    roomA = await insRoom('A', 0);
    roomB = await insRoom('B', 30);

    const insRes = async (type: string, name: string): Promise<string> =>
      (
        await admin.query(
          `INSERT INTO bookable_resources (tenant_id, property_id, type, name)
           VALUES ($1, $2, $3::bookable_resource_type, $4) RETURNING id`,
          [tenantId, propertyId, type, name],
        )
      ).rows[0].id;
    resRoomA = await insRes('ROOM', 'A');
    const resRoomB = await insRes('ROOM', 'B');
    resWhole = await insRes('WHOLE', 'Whole');

    await admin.query(
      `INSERT INTO resource_members (tenant_id, resource_id, room_id) VALUES
         ($1, $2, $5), ($1, $3, $6), ($1, $4, $5), ($1, $4, $6)`,
      [tenantId, resRoomA, resRoomB, resWhole, roomA, roomB],
    );
  });

  afterEach(async () => {
    // room_occupancy commit qua từng test → reset; xoá block (cascade occupancy còn lại)
    await admin.query(`DELETE FROM room_occupancy WHERE tenant_id = $1`, [tenantId]);
    await admin.query(`DELETE FROM room_blocks WHERE tenant_id = $1`, [tenantId]);
  });

  afterAll(async () => {
    if (admin) {
      await admin.query(`DELETE FROM room_occupancy WHERE tenant_id = $1`, [tenantId]);
      await admin.query(`DELETE FROM room_blocks WHERE tenant_id = $1`, [tenantId]);
      await admin.query(`DELETE FROM resource_members WHERE tenant_id = $1`, [tenantId]);
      await admin.query(`DELETE FROM bookable_resources WHERE tenant_id = $1`, [tenantId]);
      await admin.query(`DELETE FROM rooms WHERE tenant_id = $1`, [tenantId]);
      await admin.query(`DELETE FROM properties WHERE tenant_id = $1`, [tenantId]);
      await admin.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
      await admin.end();
    }
    await prisma?.$disconnect();
  });

  const bookRoom = (roomId: string, buffer: number, ci: number, co: number, bookingId = randomUUID()) =>
    withTenant(prisma, tenantId, (tx) =>
      occ.insertForBooking(tx, {
        tenantId,
        bookingId,
        members: [{ room_id: roomId, buffer_minutes: buffer }],
        checkIn: at(ci),
        checkOut: at(co),
      }),
    );

  it('memberRooms trả đúng phòng + buffer của resource WHOLE', async () => {
    const members = await withTenant(prisma, tenantId, (tx) => occ.memberRooms(tx, resWhole), {
      readOnly: true,
    });
    expect(members).toHaveLength(2);
    const byRoom = new Map(members.map((m) => [m.room_id, m.buffer_minutes]));
    expect(byRoom.get(roomA)).toBe(0);
    expect(byRoom.get(roomB)).toBe(30);
  });

  it('findOverlaps: phát hiện chồng lấn, bỏ qua khoảng rời nhau', async () => {
    await bookRoom(roomA, 0, 7, 9);
    const hit = await withTenant(prisma, tenantId, (tx) => occ.findOverlaps(tx, [roomA], at(8), at(10)));
    expect(hit).toHaveLength(1);
    const miss = await withTenant(prisma, tenantId, (tx) =>
      occ.findOverlaps(tx, [roomA], at(9), at(11)),
    );
    expect(miss).toHaveLength(0); // '[)' — 09:00 kề 09:00 không chồng
  });

  it('EXCLUDE: 2 booking chồng giờ cùng phòng → cái sau 23P01', async () => {
    await bookRoom(roomA, 0, 7, 9);
    await expect(bookRoom(roomA, 0, 8, 10)).rejects.toThrow(OVERLAP_RE);
  });

  it("'[)' kề ranh: [07,09) rồi [09,11) cùng phòng buffer 0 → cả hai OK", async () => {
    await bookRoom(roomA, 0, 7, 9);
    await expect(bookRoom(roomA, 0, 9, 11)).resolves.toBeUndefined();
  });

  it('buffer dọn phòng nới khoảng chặn: phòng B (buffer 30) chặn quá giờ trả', async () => {
    await bookRoom(roomB, 30, 8, 10); // chặn [07:30, 10:30)
    const blockedByBuffer = await withTenant(prisma, tenantId, (tx) =>
      occ.findOverlaps(tx, [roomB], new Date(Date.UTC(2027, 2, 10, 10, 15)), at(11)),
    );
    expect(blockedByBuffer.length).toBeGreaterThan(0); // 10:15 < 10:30 (đệm)

    await bookRoom(roomA, 0, 8, 10); // phòng A buffer 0 → chặn đúng [08,10)
    const noBuffer = await withTenant(prisma, tenantId, (tx) =>
      occ.findOverlaps(tx, [roomA], new Date(Date.UTC(2027, 2, 10, 10, 15)), at(11)),
    );
    expect(noBuffer).toHaveLength(0);
  });

  it('★ WHOLE ↔ ROOM: nguyên căn chiếm A+B → đặt phòng A trùng giờ bị chặn', async () => {
    // Đặt nguyên căn (sinh occupancy cho cả A và B)
    await withTenant(prisma, tenantId, (tx) =>
      occ.insertForBooking(tx, {
        tenantId,
        bookingId: randomUUID(),
        members: [
          { room_id: roomA, buffer_minutes: 0 },
          { room_id: roomB, buffer_minutes: 30 },
        ],
        checkIn: at(7),
        checkOut: at(9),
      }),
    );
    // Đặt riêng phòng A cùng khoảng → đụng EXCLUDE ở mức phòng vật lý
    await expect(bookRoom(roomA, 0, 7, 9)).rejects.toThrow(OVERLAP_RE);
  });

  it('huỷ (deleteForBooking) rồi đặt lại cùng giờ → OK', async () => {
    const bk = randomUUID();
    await bookRoom(roomA, 0, 7, 9, bk);
    await withTenant(prisma, tenantId, (tx) => occ.deleteForBooking(tx, bk));
    await expect(bookRoom(roomA, 0, 7, 9)).resolves.toBeUndefined();
  });

  it('block ghi cùng bảng occupancy → đụng booking đang chặn = 23P01 (cùng tx rollback)', async () => {
    await bookRoom(roomA, 0, 7, 9);
    await expect(
      withTenant(prisma, tenantId, async (tx) => {
        const blk = await tx.room_blocks.create({
          data: { tenant_id: tenantId, room_id: roomA, start_at: at(8), end_at: at(10), reason: 'MAINT' },
        });
        await occ.insertForBlock(tx, {
          tenantId,
          blockId: blk.id,
          roomId: roomA,
          startAt: at(8),
          endAt: at(10),
        });
      }),
    ).rejects.toThrow(OVERLAP_RE);
    // tx rollback → block KHÔNG còn lại
    const blocks = await admin.query(`SELECT count(*)::int AS n FROM room_blocks WHERE tenant_id = $1`, [
      tenantId,
    ]);
    expect(blocks.rows[0].n).toBe(0);
  });
});
