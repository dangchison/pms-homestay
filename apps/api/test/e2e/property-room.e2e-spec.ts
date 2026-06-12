import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance task 2.1 (HTTP): CRUD properties/rooms, tạo phòng → tự sinh
 * resource ROOM + member, cấu hình WHOLE, room_blocks (overlap → 409), PATCH
 * room If-Match (version conflict → 409), xoá phòng còn occupancy → 409.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `pr-${RUN}`;

describe('Properties / Rooms / Resources / Blocks (task 2.1)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let propertyId: string;
  let roomId: string;
  let roomId2: string;
  let blockId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const env = loadEnv();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();

    await request(http)
      .post('/api/v1/auth/register')
      .send({
        tenant_slug: tenantSlug,
        tenant_display_name: 'PR E2E',
        email: `owner-${RUN}@e2e.test`,
        password: PASSWORD,
        full_name: 'Owner',
      })
      .expect(201);
    const login = await request(http)
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', tenantSlug)
      .send({ email: `owner-${RUN}@e2e.test`, password: PASSWORD })
      .expect(200);
    token = login.body.data.access_token;
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM room_occupancy WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM room_blocks WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM resource_members WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM bookable_resources WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM rooms WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await app?.close();
  });

  it('POST /properties → 201, GET list & detail', async () => {
    const created = await request(http)
      .post('/api/v1/properties')
      .set(auth())
      .send({
        name: 'Villa Sơn Trà',
        property_type: 'HOMESTAY',
        address_line: '12 Hoàng Sa',
        province: 'Đà Nẵng',
        monthly_landlord_rent_vnd: 25_000_000,
      })
      .expect(201);
    propertyId = created.body.data.id;
    expect(created.body.data.timezone).toBe('Asia/Ho_Chi_Minh'); // DB default
    expect(created.body.data.monthly_landlord_rent_vnd).toBe(25_000_000); // BigInt → number

    const list = await request(http).get('/api/v1/properties').set(auth()).expect(200);
    expect(list.body.data.some((p: { id: string }) => p.id === propertyId)).toBe(true);
    expect(list.body.page_info.total_items).toBeGreaterThanOrEqual(1);

    await request(http).get(`/api/v1/properties/${propertyId}`).set(auth()).expect(200);
  });

  it('PATCH /properties/:id → 200 cập nhật tên', async () => {
    const res = await request(http)
      .patch(`/api/v1/properties/${propertyId}`)
      .set(auth())
      .send({ name: 'Villa Sơn Trà 2' })
      .expect(200);
    expect(res.body.data.name).toBe('Villa Sơn Trà 2');
  });

  it('POST /rooms → 201 và TỰ SINH resource ROOM + member 1:1', async () => {
    const r1 = await request(http)
      .post('/api/v1/rooms')
      .set(auth())
      .send({ property_id: propertyId, room_number: '101', buffer_minutes: 30 })
      .expect(201);
    roomId = r1.body.data.id;
    expect(r1.body.data.version).toBe(0);
    expect(r1.body.data.housekeeping_status).toBe('CLEAN');

    const r2 = await request(http)
      .post('/api/v1/rooms')
      .set(auth())
      .send({ property_id: propertyId, room_number: '102' })
      .expect(201);
    roomId2 = r2.body.data.id;

    // Auto resource ROOM xuất hiện trong danh sách resource của property
    const resources = await request(http)
      .get(`/api/v1/bookable-resources?property_id=${propertyId}`)
      .set(auth())
      .expect(200);
    const roomResources = resources.body.data.filter((x: { type: string }) => x.type === 'ROOM');
    expect(roomResources).toHaveLength(2);
    expect(
      roomResources.some((x: { room_ids: string[] }) => x.room_ids.includes(roomId)),
    ).toBe(true);
  });

  it('room_number trùng trong cùng property → 409', async () => {
    await request(http)
      .post('/api/v1/rooms')
      .set(auth())
      .send({ property_id: propertyId, room_number: '101' })
      .expect(409);
  });

  it('POST /bookable-resources WHOLE (nguyên căn) → 201 với 2 phòng thành viên', async () => {
    const res = await request(http)
      .post('/api/v1/bookable-resources')
      .set(auth())
      .send({ property_id: propertyId, name: 'Nguyên căn Villa', room_ids: [roomId, roomId2] })
      .expect(201);
    expect(res.body.data.type).toBe('WHOLE');
    expect(res.body.data.room_ids.sort()).toEqual([roomId, roomId2].sort());
  });

  it('POST /room-blocks → 201, block chồng lấn cùng phòng → 409 BOOKING_OVERLAP', async () => {
    const created = await request(http)
      .post('/api/v1/room-blocks')
      .set(auth())
      .send({
        room_id: roomId,
        start_at: '2027-05-01T07:00:00.000Z',
        end_at: '2027-05-03T05:00:00.000Z',
        reason: 'MAINTENANCE',
      })
      .expect(201);
    blockId = created.body.data.id;

    const overlap = await request(http)
      .post('/api/v1/room-blocks')
      .set(auth())
      .send({
        room_id: roomId,
        start_at: '2027-05-02T07:00:00.000Z',
        end_at: '2027-05-04T05:00:00.000Z',
        reason: 'OWNER_USE',
      });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('BOOKING_OVERLAP');
  });

  it('PATCH /rooms/:id cần If-Match; version cũ → 409, thiếu header → 428', async () => {
    await request(http)
      .patch(`/api/v1/rooms/${roomId}`)
      .set(auth())
      .send({ display_name: 'Phòng 101' })
      .expect(428); // thiếu If-Match

    const ok = await request(http)
      .patch(`/api/v1/rooms/${roomId}`)
      .set({ ...auth(), 'If-Match': '0' })
      .send({ display_name: 'Phòng 101' })
      .expect(200);
    expect(ok.body.data.version).toBe(1);
    expect(ok.body.data.display_name).toBe('Phòng 101');

    const stale = await request(http)
      .patch(`/api/v1/rooms/${roomId}`)
      .set({ ...auth(), 'If-Match': '0' })
      .send({ display_name: 'X' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('xoá phòng còn block → 409; xoá block trước rồi xoá phòng → 204', async () => {
    const blocked = await request(http).delete(`/api/v1/rooms/${roomId}`).set(auth());
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('ROOM_HAS_OCCUPANCY');

    await request(http).delete(`/api/v1/room-blocks/${blockId}`).set(auth()).expect(204);
    await request(http).delete(`/api/v1/rooms/${roomId}`).set(auth()).expect(204);
    await request(http).get(`/api/v1/rooms/${roomId}`).set(auth()).expect(404);
  });
});
