import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BookingsService } from '@modules/bookings/bookings.service';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance task 2.7 (docs/06 §4): HOLD giữ chỗ 10' → cron huỷ khi quá hạn
 * (CANCELLED HOLD_EXPIRED + xoá occupancy, đặt lại OK); POST /:id/confirm:
 * HOLD→PENDING đặt hạn cọc 24h, OWNER force→CONFIRMED.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `hx-${RUN}`;

describe('Booking HOLD expiry + confirm (task 2.7)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let resA: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const quote = async (resourceId: string, checkIn: string, checkOut: string): Promise<string> => {
    const res = await request(http)
      .post('/api/v1/pricing/quote')
      .set(auth())
      .send({ resource_id: resourceId, mode: 'DAILY', check_in: checkIn, check_out: checkOut })
      .expect(200);
    return res.body.data.quote_id;
  };

  /** Tạo booking; `hold=true` → HOLD (giữ 10'), else PENDING. */
  const book = (resourceId: string, quoteId: string, ci: string, co: string, hold = false) =>
    request(http)
      .post('/api/v1/bookings')
      .set({ ...auth(), 'Idempotency-Key': randomUUID() })
      .send({ resource_id: resourceId, quote_id: quoteId, mode: 'DAILY', check_in: ci, check_out: co, hold });

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
        tenant_display_name: 'HX E2E',
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
    resA = (
      await request(http).get(`/api/v1/bookable-resources?property_id=${propertyId}`).set(auth()).expect(200)
    ).body.data.find((r: { room_ids: string[] }) => r.room_ids.includes(room1)).id;

    await request(http)
      .post('/api/v1/rate-plans')
      .set(auth())
      .send({
        property_id: propertyId,
        name: 'DAILY',
        mode: 'DAILY',
        base_price_vnd: 500_000,
        effective_from: '2026-01-01',
        resource_ids: [resA],
      })
      .expect(201);
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
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

  it('tạo HOLD → status HOLD, expires_at ≈ now + 10 phút', async () => {
    const ci = '2026-11-01T07:00:00.000Z';
    const co = '2026-11-03T05:00:00.000Z';
    const res = await book(resA, await quote(resA, ci, co), ci, co, true).expect(201);
    expect(res.body.data.status).toBe('HOLD');
    const expires = new Date(res.body.data.expires_at).getTime();
    const delta = expires - Date.now();
    expect(delta).toBeGreaterThan(9 * 60_000);
    expect(delta).toBeLessThan(11 * 60_000);
  });

  it('confirm (mặc định) HOLD → PENDING, expires_at ≈ now + 24h', async () => {
    const ci = '2026-11-05T07:00:00.000Z';
    const co = '2026-11-07T05:00:00.000Z';
    const created = await book(resA, await quote(resA, ci, co), ci, co, true).expect(201);
    const res = await request(http)
      .post(`/api/v1/bookings/${created.body.data.id}/confirm`)
      .set(auth())
      .send({})
      .expect(200);
    expect(res.body.data.status).toBe('PENDING');
    const delta = new Date(res.body.data.expires_at).getTime() - Date.now();
    expect(delta).toBeGreaterThan(23 * 3_600_000);
    expect(delta).toBeLessThan(25 * 3_600_000);
  });

  it('OWNER confirm force → CONFIRMED, expires_at = null', async () => {
    const ci = '2026-11-10T07:00:00.000Z';
    const co = '2026-11-12T05:00:00.000Z';
    const created = await book(resA, await quote(resA, ci, co), ci, co, true).expect(201);
    const res = await request(http)
      .post(`/api/v1/bookings/${created.body.data.id}/confirm`)
      .set(auth())
      .send({ force: true })
      .expect(200);
    expect(res.body.data.status).toBe('CONFIRMED');
    expect(res.body.data.expires_at).toBeNull();
  });

  it('★ cron expire HOLD quá hạn → CANCELLED(HOLD_EXPIRED) + xoá occupancy + đặt lại OK', async () => {
    const ci = '2026-11-15T07:00:00.000Z';
    const co = '2026-11-17T05:00:00.000Z';
    const created = await book(resA, await quote(resA, ci, co), ci, co, true).expect(201);
    const id = created.body.data.id;

    // occupancy đã sinh ngay khi HOLD
    const occBefore = await admin.query(`SELECT count(*)::int n FROM room_occupancy WHERE booking_id = $1`, [id]);
    expect(occBefore.rows[0].n).toBeGreaterThan(0);

    // ép quá hạn rồi chạy cron (gọi thẳng logic — không chờ tick mỗi phút)
    await admin.query(`UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1`, [id]);
    const cancelled = await app.get(BookingsService).sweepExpiredHolds();
    expect(cancelled).toBeGreaterThanOrEqual(1);

    const after = await request(http).get(`/api/v1/bookings/${id}`).set(auth()).expect(200);
    expect(after.body.data.status).toBe('CANCELLED');
    expect(after.body.data.cancellation_reason).toBe('HOLD_EXPIRED');

    const occAfter = await admin.query(`SELECT count(*)::int n FROM room_occupancy WHERE booking_id = $1`, [id]);
    expect(occAfter.rows[0].n).toBe(0);

    // history ghi nhận chuyển HOLD→CANCELLED bởi hệ thống (changed_by NULL)
    const hist = await admin.query(
      `SELECT from_status, to_status, changed_by, reason FROM booking_status_history
       WHERE booking_id = $1 AND to_status = 'CANCELLED'`,
      [id],
    );
    expect(hist.rows[0]).toMatchObject({ from_status: 'HOLD', to_status: 'CANCELLED', changed_by: null, reason: 'HOLD_EXPIRED' });

    // slot đã giải phóng → đặt lại cùng giờ OK
    await book(resA, await quote(resA, ci, co), ci, co).expect(201);
  });
});
