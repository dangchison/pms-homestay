import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance task 6.2 (spec ui/01 #C1): GET /occupancy là nguồn dữ liệu calendar.
 * Đọc room_occupancy JOIN bookings/blocks → trục Y resources (WHOLE trước) + bars
 * booking (is_whole + guest_name + buffer span) + blocks gắn MỌI resource chứa
 * phòng bị chặn. Booking terminal (cancelled) tự loại (occupancy đã xoá). Validate
 * to>from; property lạ → 404.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `occ-${RUN}`;
const FROM = '2026-07-01T00:00:00.000Z';
const TO = '2026-09-01T00:00:00.000Z';

describe('Calendar occupancy — GET /occupancy (task 6.2)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let propertyId: string;
  let room2: string;
  let resA: string;
  let resB: string;
  let resWhole: string;
  let guestId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const quote = async (resourceId: string, checkIn: string, checkOut: string): Promise<string> => {
    const res = await request(http)
      .post('/api/v1/pricing/quote')
      .set(auth())
      .send({ resource_id: resourceId, mode: 'DAILY', check_in: checkIn, check_out: checkOut })
      .expect(200);
    return res.body.data.quote_id;
  };

  const book = (resourceId: string, quoteId: string, checkIn: string, checkOut: string, guest?: string) =>
    request(http)
      .post('/api/v1/bookings')
      .set({ ...auth(), 'Idempotency-Key': randomUUID() })
      .send({
        resource_id: resourceId,
        quote_id: quoteId,
        mode: 'DAILY',
        check_in: checkIn,
        check_out: checkOut,
        ...(guest ? { guest_id: guest } : {}),
      });

  const getOccupancy = (from = FROM, to = TO, prop = propertyId) =>
    request(http).get(`/api/v1/occupancy?property_id=${prop}&from=${from}&to=${to}`).set(auth());

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
        tenant_display_name: 'OCC E2E',
        email: `owner-${RUN}@e2e.test`,
        password: PASSWORD,
        full_name: 'Owner',
      })
      .expect(201);
    token = (
      await request(http)
        .post('/api/v1/auth/login')
        .set('X-Tenant-Slug', tenantSlug)
        .send({ email: `owner-${RUN}@e2e.test`, password: PASSWORD })
        .expect(200)
    ).body.data.access_token;

    propertyId = (
      await request(http)
        .post('/api/v1/properties')
        .set(auth())
        .send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' })
        .expect(201)
    ).body.data.id;
    const room1 = (
      await request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: '101' }).expect(201)
    ).body.data.id;
    room2 = (
      await request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: '102' }).expect(201)
    ).body.data.id;
    const resources = (
      await request(http).get(`/api/v1/bookable-resources?property_id=${propertyId}`).set(auth()).expect(200)
    ).body.data as { id: string; room_ids: string[] }[];
    resA = resources.find((r) => r.room_ids.includes(room1))!.id;
    resB = resources.find((r) => r.room_ids.includes(room2))!.id;
    resWhole = (
      await request(http)
        .post('/api/v1/bookable-resources')
        .set(auth())
        .send({ property_id: propertyId, name: 'Nguyên căn', room_ids: [room1, room2] })
        .expect(201)
    ).body.data.id;

    await request(http)
      .post('/api/v1/rate-plans')
      .set(auth())
      .send({
        property_id: propertyId,
        name: 'DAILY',
        mode: 'DAILY',
        base_price_vnd: 500_000,
        effective_from: '2026-01-01',
        resource_ids: [resA, resB, resWhole],
      })
      .expect(201);

    guestId = (
      await request(http)
        .post('/api/v1/guests')
        .set(auth())
        .send({ full_name: 'Nguyễn Văn A', phone: '0900000001' })
        .expect(201)
    ).body.data.id;
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM invoice_items WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM invoices WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM room_occupancy WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM room_blocks WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM booking_status_history WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM quotes WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM bookings WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM rate_plan_resources WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM rate_plans WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM resource_members WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM bookable_resources WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM rooms WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM guests WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM idempotency_keys WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM document_counters WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await app?.close();
  });

  it('resources: WHOLE đứng đầu; ROOM có dot housekeeping + số phòng, WHOLE = null', async () => {
    const res = await getOccupancy().expect(200);
    const { resources } = res.body.data as {
      resources: { id: string; type: string; room_number: string | null; housekeeping_status: string | null }[];
    };
    expect(resources.length).toBe(3);
    expect(resources[0]!.type).toBe('WHOLE'); // WHOLE trước (wireframe "Nguyên căn" trên cùng)
    const room = resources.find((r) => r.id === resA)!;
    expect(room.type).toBe('ROOM');
    expect(room.room_number).toBe('101');
    expect(room.housekeeping_status).toBe('CLEAN'); // default
    const whole = resources.find((r) => r.id === resWhole)!;
    expect(whole.housekeeping_status).toBeNull();
    expect(whole.room_number).toBeNull();
  });

  it('booking 1 phòng + khách → bar đúng resource, is_whole=false, guest_name, buffer span phủ giờ thực', async () => {
    const ci = '2026-08-01T07:00:00.000Z';
    const co = '2026-08-03T05:00:00.000Z';
    const created = await book(resA, await quote(resA, ci, co), ci, co, guestId).expect(201);
    const res = await getOccupancy().expect(200);
    const b = (res.body.data.bookings as any[]).find((x) => x.id === created.body.data.id)!;
    expect(b).toBeDefined();
    expect(b.resource_id).toBe(resA);
    expect(b.is_whole).toBe(false);
    expect(b.guest_name).toBe('Nguyễn Văn A');
    expect(b.status).toBe('PENDING');
    expect(b.total_amount_vnd).toBe(1_000_000);
    // occupancy span (có buffer) phủ trùm giờ thực
    expect(new Date(b.occupancy_start).getTime()).toBeLessThanOrEqual(new Date(ci).getTime());
    expect(new Date(b.occupancy_end).getTime()).toBeGreaterThanOrEqual(new Date(co).getTime());
  });

  it('booking WHOLE → is_whole=true trên resource nguyên căn', async () => {
    const ci = '2026-08-10T07:00:00.000Z';
    const co = '2026-08-12T05:00:00.000Z';
    const created = await book(resWhole, await quote(resWhole, ci, co), ci, co).expect(201);
    const res = await getOccupancy().expect(200);
    const b = (res.body.data.bookings as any[]).find((x) => x.id === created.body.data.id)!;
    expect(b.resource_id).toBe(resWhole);
    expect(b.is_whole).toBe(true);
  });

  it('★ room block trên 1 phòng → hiện trên CẢ resource ROOM lẫn WHOLE chứa phòng đó', async () => {
    const created = await request(http)
      .post('/api/v1/room-blocks')
      .set(auth())
      .send({ room_id: room2, start_at: '2026-08-05T00:00:00.000Z', end_at: '2026-08-06T00:00:00.000Z', reason: 'MAINTENANCE' })
      .expect(201);
    const blockId = created.body.data.id;
    const res = await getOccupancy().expect(200);
    const mine = (res.body.data.blocks as any[]).filter((x) => x.id === blockId);
    const resourceIds = mine.map((x) => x.resource_id).sort();
    expect(resourceIds).toEqual([resB, resWhole].sort());
    expect(mine.every((x) => x.room_id === room2)).toBe(true);
    expect(mine.every((x) => x.reason === 'MAINTENANCE')).toBe(true);
  });

  it('booking đã hủy → biến mất khỏi calendar (occupancy đã xoá)', async () => {
    const ci = '2026-08-20T07:00:00.000Z';
    const co = '2026-08-22T05:00:00.000Z';
    const created = await book(resB, await quote(resB, ci, co), ci, co).expect(201);
    await request(http)
      .post(`/api/v1/bookings/${created.body.data.id}/cancel`)
      .set(auth())
      .send({ reason: 'khách đổi lịch' })
      .expect(200);
    const res = await getOccupancy().expect(200);
    expect((res.body.data.bookings as any[]).some((x) => x.id === created.body.data.id)).toBe(false);
  });

  it('to <= from → 400 (validation)', async () => {
    const res = await getOccupancy('2026-09-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z').expect(400);
    expect(res.body.error.code).toBeDefined();
  });

  it('property không tồn tại → 404 PROPERTY_NOT_FOUND', async () => {
    const res = await getOccupancy(FROM, TO, randomUUID()).expect(404);
    expect(res.body.error.code).toBe('PROPERTY_NOT_FOUND');
  });
});
