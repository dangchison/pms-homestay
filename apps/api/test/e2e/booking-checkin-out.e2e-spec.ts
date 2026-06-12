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
 * ★ Acceptance task 2.8 (docs/06 §6): check-in (chỉ CONFIRMED), check-out (xoá
 * occupancy), switch-resource (delete+reinsert occupancy ở resource mới, EXCLUDE
 * chặn nếu bận); transition sai → 422 BOOKING_INVALID_STATUS.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `co-${RUN}`;

describe('Booking check-in/out + switch-resource (task 2.8)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let resA: string;
  let resB: string;
  let room1: string;
  let room2: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const quote = async (resourceId: string, ci: string, co: string): Promise<string> => {
    const res = await request(http)
      .post('/api/v1/pricing/quote')
      .set(auth())
      .send({ resource_id: resourceId, mode: 'DAILY', check_in: ci, check_out: co })
      .expect(200);
    return res.body.data.quote_id;
  };

  const book = async (resourceId: string, ci: string, co: string): Promise<string> => {
    const q = await quote(resourceId, ci, co);
    const res = await request(http)
      .post('/api/v1/bookings')
      .set({ ...auth(), 'Idempotency-Key': randomUUID() })
      .send({ resource_id: resourceId, quote_id: q, mode: 'DAILY', check_in: ci, check_out: co })
      .expect(201);
    return res.body.data.id;
  };

  /** PENDING → CONFIRMED qua OWNER force (cho phép check-in). */
  const confirm = (id: string) =>
    request(http).post(`/api/v1/bookings/${id}/confirm`).set(auth()).send({ force: true }).expect(200);

  const occRoom = async (bookingId: string): Promise<string | null> => {
    const r = await admin.query(`SELECT room_id::text FROM room_occupancy WHERE booking_id = $1`, [bookingId]);
    return r.rows[0]?.room_id ?? null;
  };

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
        tenant_display_name: 'CO E2E',
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

    const propertyId = (
      await request(http)
        .post('/api/v1/properties')
        .set(auth())
        .send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' })
        .expect(201)
    ).body.data.id;
    room1 = (
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

    await request(http)
      .post('/api/v1/rate-plans')
      .set(auth())
      .send({
        property_id: propertyId,
        name: 'DAILY',
        mode: 'DAILY',
        base_price_vnd: 500_000,
        effective_from: '2026-01-01',
        resource_ids: [resA, resB],
      })
      .expect(201);
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM invoice_items WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM invoices WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM room_occupancy WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM booking_status_history WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM quotes WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM bookings WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM rate_plans WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM resource_members WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM bookable_resources WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM rooms WHERE tenant_id IN ${tid}`);
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

  it('check-in PENDING → 422; CONFIRMED → CHECKED_IN + actual_check_in', async () => {
    const id = await book(resA, '2026-12-01T07:00:00.000Z', '2026-12-03T05:00:00.000Z');
    // PENDING chưa được check-in
    const early = await request(http).post(`/api/v1/bookings/${id}/check-in`).set(auth()).send({});
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('BOOKING_INVALID_STATUS');

    await confirm(id);
    const res = await request(http).post(`/api/v1/bookings/${id}/check-in`).set(auth()).send({}).expect(200);
    expect(res.body.data.status).toBe('CHECKED_IN');
    expect(res.body.data.actual_check_in).not.toBeNull();
  });

  it('check-out CHECKED_IN → CHECKED_OUT + actual_check_out + xoá occupancy (đặt lại OK)', async () => {
    const ci = '2026-12-05T07:00:00.000Z';
    const co = '2026-12-07T05:00:00.000Z';
    const id = await book(resA, ci, co);
    await confirm(id);
    await request(http).post(`/api/v1/bookings/${id}/check-in`).set(auth()).send({}).expect(200);

    const res = await request(http).post(`/api/v1/bookings/${id}/check-out`).set(auth()).send({}).expect(200);
    expect(res.body.data.status).toBe('CHECKED_OUT');
    expect(res.body.data.actual_check_out).not.toBeNull();
    expect(await occRoom(id)).toBeNull(); // occupancy đã xoá

    // check-out lần nữa → 422 (terminal)
    const again = await request(http).post(`/api/v1/bookings/${id}/check-out`).set(auth()).send({});
    expect(again.status).toBe(422);

    // phòng đã giải phóng → đặt lại cùng giờ OK
    await book(resA, ci, co);
  });

  it('switch-resource → đổi resource_id + occupancy chuyển sang phòng mới (phòng cũ giải phóng)', async () => {
    const ci = '2026-12-10T07:00:00.000Z';
    const co = '2026-12-12T05:00:00.000Z';
    const id = await book(resA, ci, co);
    expect(await occRoom(id)).toBe(room1);

    const res = await request(http)
      .post(`/api/v1/bookings/${id}/switch-resource`)
      .set(auth())
      .send({ new_resource_id: resB, reason: 'khách muốn phòng tầng cao' })
      .expect(200);
    expect(res.body.data.resource_id).toBe(resB);
    expect(await occRoom(id)).toBe(room2); // chuyển sang phòng mới

    // phòng cũ (resA/room1) đã trống → đặt được
    await book(resA, ci, co);
  });

  it('switch sang resource đang bận → 409 BOOKING_OVERLAP, occupancy cũ giữ nguyên (rollback)', async () => {
    const ci = '2026-12-15T07:00:00.000Z';
    const co = '2026-12-17T05:00:00.000Z';
    const b1 = await book(resA, ci, co);
    await book(resB, ci, co); // resB bận cùng khoảng

    const res = await request(http)
      .post(`/api/v1/bookings/${b1}/switch-resource`)
      .set(auth())
      .send({ new_resource_id: resB, reason: 'thử đổi' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BOOKING_OVERLAP');
    expect(await occRoom(b1)).toBe(room1); // tx rollback → vẫn ở phòng cũ
  });

  it('switch sang chính resource hiện tại → 422 BOOKING_SAME_RESOURCE', async () => {
    const id = await book(resA, '2026-12-20T07:00:00.000Z', '2026-12-22T05:00:00.000Z');
    const res = await request(http)
      .post(`/api/v1/bookings/${id}/switch-resource`)
      .set(auth())
      .send({ new_resource_id: resA, reason: 'noop' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BOOKING_SAME_RESOURCE');
  });
});
