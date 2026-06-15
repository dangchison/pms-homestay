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
 * ★ Acceptance task 6.4 (F1): GET /invoices chế độ list-theo-property + filter +
 * pagination (JOIN bookings). Booking PENDING → auto DEPOSIT invoice → list thấy.
 * Filter kind/status; refine cần booking_id|property_id.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `inv-${RUN}`;

describe('Invoice list-by-property — GET /invoices (task 6.4)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let propertyId: string;
  let depositInvoiceId: string;

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
        tenant_display_name: 'INV E2E',
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
    const room = (
      await request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: '101' }).expect(201)
    ).body.data.id;
    const resId = (
      await request(http).get(`/api/v1/bookable-resources?property_id=${propertyId}`).set(auth()).expect(200)
    ).body.data.find((r: { room_ids: string[] }) => r.room_ids.includes(room)).id;
    await request(http)
      .post('/api/v1/rate-plans')
      .set(auth())
      .send({ property_id: propertyId, name: 'DAILY', mode: 'DAILY', base_price_vnd: 500_000, effective_from: '2026-01-01', resource_ids: [resId], deposit_type: 'PERCENT', deposit_value: 3000 })
      .expect(201);

    const ci = '2026-08-01T07:00:00.000Z';
    const co = '2026-08-03T05:00:00.000Z';
    const quoteId = (
      await request(http)
        .post('/api/v1/pricing/quote')
        .set(auth())
        .send({ resource_id: resId, mode: 'DAILY', check_in: ci, check_out: co })
        .expect(200)
    ).body.data.quote_id;
    const bookingId = (
      await request(http)
        .post('/api/v1/bookings')
        .set({ ...auth(), 'Idempotency-Key': randomUUID() })
        .send({ resource_id: resId, quote_id: quoteId, mode: 'DAILY', check_in: ci, check_out: co })
        .expect(201)
    ).body.data.id;
    // booking PENDING → DEPOSIT invoice tự tạo
    const byBooking = (
      await request(http).get(`/api/v1/invoices?booking_id=${bookingId}`).set(auth()).expect(200)
    ).body.data as { id: string; kind: string }[];
    depositInvoiceId = byBooking.find((i) => i.kind === 'DEPOSIT')!.id;
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM payment_attempts WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM payments WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM invoice_items WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM invoices WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM room_occupancy WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM booking_status_history WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM quotes WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM bookings WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM rate_plan_resources WHERE tenant_id IN ${tid}`);
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

  it('list theo property → có DEPOSIT invoice + page_info', async () => {
    const res = await request(http).get(`/api/v1/invoices?property_id=${propertyId}`).set(auth()).expect(200);
    expect(res.body.page_info).toMatchObject({ page: 1, total_items: expect.any(Number) });
    expect(res.body.page_info.total_items).toBeGreaterThanOrEqual(1);
    const ids = (res.body.data as { id: string }[]).map((i) => i.id);
    expect(ids).toContain(depositInvoiceId);
  });

  it('filter kind=DEPOSIT → có; kind=STAY → rỗng (booking mới chỉ có cọc)', async () => {
    const dep = await request(http).get(`/api/v1/invoices?property_id=${propertyId}&kind=DEPOSIT`).set(auth()).expect(200);
    expect((dep.body.data as { kind: string }[]).every((i) => i.kind === 'DEPOSIT')).toBe(true);
    expect((dep.body.data as { id: string }[]).some((i) => i.id === depositInvoiceId)).toBe(true);
    const stay = await request(http).get(`/api/v1/invoices?property_id=${propertyId}&kind=STAY`).set(auth()).expect(200);
    expect(stay.body.data).toHaveLength(0);
  });

  it('filter status=VOID → rỗng (cọc chưa void)', async () => {
    const res = await request(http).get(`/api/v1/invoices?property_id=${propertyId}&status=VOID`).set(auth()).expect(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('pagination page_size=1 → đúng page_info', async () => {
    const res = await request(http).get(`/api/v1/invoices?property_id=${propertyId}&page=1&page_size=1`).set(auth()).expect(200);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
    expect(res.body.page_info.page_size).toBe(1);
  });

  it('thiếu cả booking_id lẫn property_id → 400', async () => {
    await request(http).get('/api/v1/invoices').set(auth()).expect(400);
  });

  it('record payment + GET /payments?invoice_id → liệt kê payment SUCCEEDED', async () => {
    await request(http)
      .post('/api/v1/payments')
      .set({ ...auth(), 'Idempotency-Key': randomUUID() })
      .send({ invoice_id: depositInvoiceId, amount_vnd: 100_000, method: 'CASH' })
      .expect(201);
    const res = await request(http).get(`/api/v1/payments?invoice_id=${depositInvoiceId}`).set(auth()).expect(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].invoice_id).toBe(depositInvoiceId);
    expect(res.body.data[0].status).toBe('SUCCEEDED');
  });
});
