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
 * ★ Acceptance task 2.6 (docs/06 §8): booking qua createBookingTx — chống
 * overbooking thật ở DB (2 concurrent → 1 thành công 1×409; WHOLE↔ROOM → chỉ 1);
 * cancel rồi đặt lại OK; verify quote (PRICE_CHANGED); If-Match version conflict;
 * Idempotency-Key replay.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `bk-${RUN}`;

describe('Booking core — createBookingTx (task 2.6)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let resA: string;
  let resB: string;
  let resWhole: string;
  let planId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  /** Tạo quote cho resource + khoảng ngày → quote_id. */
  const quote = async (resourceId: string, checkIn: string, checkOut: string): Promise<string> => {
    const res = await request(http)
      .post('/api/v1/pricing/quote')
      .set(auth())
      .send({ resource_id: resourceId, mode: 'DAILY', check_in: checkIn, check_out: checkOut })
      .expect(200);
    return res.body.data.quote_id;
  };

  const book = (resourceId: string, quoteId: string, checkIn: string, checkOut: string) =>
    request(http)
      .post('/api/v1/bookings')
      .set({ ...auth(), 'Idempotency-Key': randomUUID() })
      .send({ resource_id: resourceId, quote_id: quoteId, mode: 'DAILY', check_in: checkIn, check_out: checkOut });

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
        tenant_display_name: 'BK E2E',
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
    const room1 = (
      await request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: '101' }).expect(201)
    ).body.data.id;
    const room2 = (
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

    // Gói DAILY base 500k, KHÔNG rule (giá = số đêm × 500k), gán cho cả 3 resource
    planId = (
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
        .expect(201)
    ).body.data.id;
  });

  afterAll(async () => {
    // Đóng app TRƯỚC khi dọn DB: dừng OutboxDispatcher/worker để nó không sinh thêm
    // notifications (FK → users) trong lúc cleanup → tránh race FK lúc DELETE users.
    await app?.close();
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      // notifications (FK → users) do OutboxDispatcher sinh từ booking.created/cancelled — xoá trước users
      await admin.query(`DELETE FROM notifications WHERE tenant_id IN ${tid}`);
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
  });

  it('tạo booking PENDING (2 đêm) → 201, booking_code BK-, total 2×500k', async () => {
    const ci = '2026-08-01T07:00:00.000Z';
    const co = '2026-08-03T05:00:00.000Z';
    const q = await quote(resA, ci, co);
    const res = await book(resA, q, ci, co).expect(201);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.booking_code).toMatch(/^BK-\d{6}-\d{4}$/);
    expect(res.body.data.total_amount_vnd).toBe(1_000_000);
  });

  it('★ 2 concurrent cùng resource cùng giờ → 1 thành công, 1 × 409 BOOKING_OVERLAP', async () => {
    const ci = '2026-08-10T07:00:00.000Z';
    const co = '2026-08-12T05:00:00.000Z';
    const [q1, q2] = await Promise.all([quote(resA, ci, co), quote(resA, ci, co)]);
    const [r1, r2] = await Promise.all([book(resA, q1, ci, co), book(resA, q2, ci, co)]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
    const conflict = r1.status === 409 ? r1 : r2;
    expect(conflict.body.error.code).toBe('BOOKING_OVERLAP');
  });

  it('★ concurrent WHOLE ↔ ROOM cùng giờ → chỉ 1 thành công', async () => {
    const ci = '2026-08-20T07:00:00.000Z';
    const co = '2026-08-22T05:00:00.000Z';
    const [qw, qa] = await Promise.all([quote(resWhole, ci, co), quote(resA, ci, co)]);
    const [rw, ra] = await Promise.all([book(resWhole, qw, ci, co), book(resA, qa, ci, co)]);
    const ok = [rw, ra].filter((r) => r.status === 201);
    const conflict = [rw, ra].filter((r) => r.status === 409);
    expect(ok).toHaveLength(1);
    expect(conflict).toHaveLength(1);
    expect(conflict[0]!.body.error.code).toBe('BOOKING_OVERLAP');
  });

  it('cancel rồi đặt lại cùng giờ → OK', async () => {
    const ci = '2026-09-01T07:00:00.000Z';
    const co = '2026-09-03T05:00:00.000Z';
    const created = await book(resB, await quote(resB, ci, co), ci, co).expect(201);
    await request(http)
      .post(`/api/v1/bookings/${created.body.data.id}/cancel`)
      .set(auth())
      .send({ reason: 'khách đổi lịch' })
      .expect(200);
    // đặt lại cùng giờ → occupancy đã xoá nên OK
    await book(resB, await quote(resB, ci, co), ci, co).expect(201);
  });

  it('verify quote: giá đổi sau khi báo giá → 409 PRICE_CHANGED', async () => {
    const ci = '2026-09-10T07:00:00.000Z';
    const co = '2026-09-12T05:00:00.000Z';
    const q = await quote(resA, ci, co);
    // bump giá plan sau khi đã quote
    await request(http)
      .patch(`/api/v1/rate-plans/${planId}`)
      .set(auth())
      .send({ base_price_vnd: 700_000 })
      .expect(200);
    const res = await book(resA, q, ci, co);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRICE_CHANGED');
    // trả giá cũ về để các test sau ổn định
    await request(http).patch(`/api/v1/rate-plans/${planId}`).set(auth()).send({ base_price_vnd: 500_000 }).expect(200);
  });

  it('PATCH If-Match version cũ → 409 VERSION_CONFLICT', async () => {
    const ci = '2026-09-20T07:00:00.000Z';
    const co = '2026-09-22T05:00:00.000Z';
    const created = await book(resA, await quote(resA, ci, co), ci, co).expect(201);
    const id = created.body.data.id;
    await request(http)
      .patch(`/api/v1/bookings/${id}`)
      .set({ ...auth(), 'If-Match': '0' })
      .send({ notes: 'ghi chú 1' })
      .expect(200);
    const stale = await request(http)
      .patch(`/api/v1/bookings/${id}`)
      .set({ ...auth(), 'If-Match': '0' })
      .send({ notes: 'ghi chú 2' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('Idempotency-Key trùng + body trùng → replay cùng booking (không tạo trùng)', async () => {
    const ci = '2026-10-01T07:00:00.000Z';
    const co = '2026-10-03T05:00:00.000Z';
    const q = await quote(resA, ci, co);
    const key = randomUUID();
    const body = { resource_id: resA, quote_id: q, mode: 'DAILY', check_in: ci, check_out: co };
    const first = await request(http).post('/api/v1/bookings').set({ ...auth(), 'Idempotency-Key': key }).send(body).expect(201);
    const replay = await request(http).post('/api/v1/bookings').set({ ...auth(), 'Idempotency-Key': key }).send(body);
    expect(replay.body.data.id).toBe(first.body.data.id); // cùng booking, không tạo mới
    const { rows } = await admin.query(
      `SELECT count(*)::int AS n FROM bookings WHERE resource_id = $1 AND check_in = $2`,
      [resA, ci],
    );
    expect(rows[0].n).toBe(1); // chỉ 1 booking
  });

  // ── Reschedule (A3 F3 — kéo mép calendar) ──────────────────────────────────
  it('★ reschedule 2 đêm → 3 đêm: 200, ngày mới + total tính lại 3×500k', async () => {
    const ci = '2026-11-01T07:00:00.000Z';
    const co = '2026-11-03T05:00:00.000Z';
    const created = await book(resA, await quote(resA, ci, co), ci, co).expect(201);
    expect(created.body.data.total_amount_vnd).toBe(1_000_000);

    const newCo = '2026-11-04T05:00:00.000Z';
    const res = await request(http)
      .post(`/api/v1/bookings/${created.body.data.id}/reschedule`)
      .set(auth())
      .send({ check_in: ci, check_out: newCo, reason: 'khách ở thêm 1 đêm' })
      .expect(200);
    expect(res.body.data.check_out).toBe(newCo);
    expect(res.body.data.total_amount_vnd).toBe(1_500_000); // 3 đêm × 500k
    expect(res.body.data.resource_id).toBe(resA); // giữ nguyên phòng
  });

  it('reschedule lên khoảng đã có booking khác → 409 BOOKING_OVERLAP (rollback giữ chỗ cũ)', async () => {
    const aCi = '2026-11-10T07:00:00.000Z';
    const aCo = '2026-11-12T05:00:00.000Z';
    await book(resA, await quote(resA, aCi, aCo), aCi, aCo).expect(201);
    const bCi = '2026-11-20T07:00:00.000Z';
    const bCo = '2026-11-22T05:00:00.000Z';
    const b2 = await book(resA, await quote(resA, bCi, bCo), bCi, bCo).expect(201);

    const res = await request(http)
      .post(`/api/v1/bookings/${b2.body.data.id}/reschedule`)
      .set(auth())
      .send({ check_in: aCi, check_out: aCo, reason: 'thử dời chồng lịch' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BOOKING_OVERLAP');

    // b2 vẫn giữ occupancy cũ (tx rollback) → reschedule sang khoảng trống OK
    const free = '2026-11-25T07:00:00.000Z';
    const freeCo = '2026-11-27T05:00:00.000Z';
    await request(http)
      .post(`/api/v1/bookings/${b2.body.data.id}/reschedule`)
      .set(auth())
      .send({ check_in: free, check_out: freeCo, reason: 'dời sang khoảng trống' })
      .expect(200);
  });

  it('reschedule trùng lịch cũ → 422 BOOKING_SAME_DATES', async () => {
    const ci = '2026-12-01T07:00:00.000Z';
    const co = '2026-12-03T05:00:00.000Z';
    const created = await book(resA, await quote(resA, ci, co), ci, co).expect(201);
    const res = await request(http)
      .post(`/api/v1/bookings/${created.body.data.id}/reschedule`)
      .set(auth())
      .send({ check_in: ci, check_out: co, reason: 'không đổi' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BOOKING_SAME_DATES');
  });
});
