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
 * ★ Acceptance task 3.2 (docs/09 §3-4, ADR-0003): DEPOSIT invoice issue tại PENDING
 * theo cọc gói giá; cọc PAID → booking auto-CONFIRMED; check-out → STAY invoice
 * (items quote + DEPOSIT_APPLIED âm) cấn cọc đúng số dư; ad-hoc ADJUSTMENT + VOID
 * giữ số; trigger total_vnd = SUM(items).
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `inv-${RUN}`;

describe('Invoices — deposit/stay/adjustment (task 3.2)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let resDeposit: string; // resource gắn gói cọc 30%
  let resNone: string; // resource gắn gói cọc NONE

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const quote = async (resourceId: string, ci: string, co: string): Promise<string> =>
    (
      await request(http)
        .post('/api/v1/pricing/quote')
        .set(auth())
        .send({ resource_id: resourceId, mode: 'DAILY', check_in: ci, check_out: co })
        .expect(200)
    ).body.data.quote_id;

  const book = async (resourceId: string, ci: string, co: string): Promise<string> =>
    (
      await request(http)
        .post('/api/v1/bookings')
        .set({ ...auth(), 'Idempotency-Key': randomUUID() })
        .send({
          resource_id: resourceId,
          quote_id: await quote(resourceId, ci, co),
          mode: 'DAILY',
          check_in: ci,
          check_out: co,
        })
        .expect(201)
    ).body.data.id;

  const invoicesOf = async (bookingId: string) =>
    (await request(http).get(`/api/v1/invoices?booking_id=${bookingId}`).set(auth()).expect(200)).body
      .data as Array<{
      id: string;
      kind: string;
      status: string;
      total_vnd: number;
      paid_vnd: number;
      balance_vnd: number;
      items: Array<{ item_type: string; amount_vnd: number; ref_invoice_id: string | null }>;
    }>;

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

    const propertyId = (
      await request(http)
        .post('/api/v1/properties')
        .set(auth())
        .send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' })
        .expect(201)
    ).body.data.id;
    const mkRoom = async (n: string) =>
      (await request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: n }).expect(201))
        .body.data.id;
    const room1 = await mkRoom('101');
    const room2 = await mkRoom('102');
    const resources = (
      await request(http).get(`/api/v1/bookable-resources?property_id=${propertyId}`).set(auth()).expect(200)
    ).body.data as { id: string; room_ids: string[] }[];
    resDeposit = resources.find((r) => r.room_ids.includes(room1))!.id;
    resNone = resources.find((r) => r.room_ids.includes(room2))!.id;

    // Gói cọc 30% (PERCENT 3000 bps) cho resDeposit
    await request(http)
      .post('/api/v1/rate-plans')
      .set(auth())
      .send({
        property_id: propertyId,
        name: 'Cọc 30%',
        mode: 'DAILY',
        base_price_vnd: 500_000,
        effective_from: '2026-01-01',
        deposit_type: 'PERCENT',
        deposit_value: 3000,
        resource_ids: [resDeposit],
      })
      .expect(201);
    // Gói cọc NONE cho resNone
    await request(http)
      .post('/api/v1/rate-plans')
      .set(auth())
      .send({
        property_id: propertyId,
        name: 'Không cọc',
        mode: 'DAILY',
        base_price_vnd: 500_000,
        effective_from: '2026-01-01',
        deposit_type: 'NONE',
        resource_ids: [resNone],
      })
      .expect(201);
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

  it('★ cọc 30% → DEPOSIT invoice → pay → CONFIRMED → checkout → STAY cấn cọc đúng số dư', async () => {
    const ci = '2027-02-01T07:00:00.000Z';
    const co = '2027-02-03T05:00:00.000Z'; // 2 đêm × 500k = 1,000,000
    const bookingId = await book(resDeposit, ci, co);

    // DEPOSIT invoice issue ngay tại PENDING — total = 30% × 1,000,000 = 300,000
    let invs = await invoicesOf(bookingId);
    expect(invs).toHaveLength(1);
    const deposit = invs[0]!;
    expect(deposit.kind).toBe('DEPOSIT');
    expect(deposit.status).toBe('ISSUED');
    expect(deposit.total_vnd).toBe(300_000);
    expect(deposit.balance_vnd).toBe(300_000);

    // booking đang PENDING
    expect((await request(http).get(`/api/v1/bookings/${bookingId}`).set(auth()).expect(200)).body.data.status).toBe(
      'PENDING',
    );

    // Thanh toán cọc qua POST /payments → trigger đẩy invoice PAID → booking auto-CONFIRMED
    await request(http)
      .post('/api/v1/payments')
      .set({ ...auth(), 'Idempotency-Key': randomUUID() })
      .send({ invoice_id: deposit.id, amount_vnd: 300_000, method: 'CASH' })
      .expect(201);
    expect((await request(http).get(`/api/v1/bookings/${bookingId}`).set(auth()).expect(200)).body.data.status).toBe(
      'CONFIRMED',
    );
    invs = await invoicesOf(bookingId);
    expect(invs[0]!.status).toBe('PAID');
    expect(invs[0]!.paid_vnd).toBe(300_000);
    expect(invs[0]!.balance_vnd).toBe(0);

    // check-in → check-out → STAY invoice
    await request(http).post(`/api/v1/bookings/${bookingId}/check-in`).set(auth()).expect(200);
    await request(http).post(`/api/v1/bookings/${bookingId}/check-out`).set(auth()).expect(200);

    invs = await invoicesOf(bookingId);
    const stay = invs.find((i) => i.kind === 'STAY')!;
    expect(stay.status).toBe('ISSUED');
    // tiền phòng 1,000,000 − cọc đã thu 300,000 = 700,000 còn phải trả
    expect(stay.total_vnd).toBe(700_000);
    expect(stay.balance_vnd).toBe(700_000);
    const applied = stay.items.find((it) => it.item_type === 'DEPOSIT_APPLIED')!;
    expect(applied.amount_vnd).toBe(-300_000);
    expect(applied.ref_invoice_id).toBe(deposit.id);
    // bất biến total = SUM(items)
    expect(stay.total_vnd).toBe(stay.items.reduce((s, it) => s + it.amount_vnd, 0));
  });

  it('gói cọc NONE → không sinh DEPOSIT invoice; OWNER force confirm trực tiếp', async () => {
    const bookingId = await book(resNone, '2027-03-01T07:00:00.000Z', '2027-03-02T05:00:00.000Z');
    expect(await invoicesOf(bookingId)).toHaveLength(0);
    const res = await request(http)
      .post(`/api/v1/bookings/${bookingId}/confirm`)
      .set(auth())
      .send({ force: true })
      .expect(200);
    expect(res.body.data.status).toBe('CONFIRMED');
  });

  it('ad-hoc ADJUSTMENT invoice (issue) → VOID giữ số + 422 khi void lần 2', async () => {
    const created = await request(http)
      .post('/api/v1/invoices')
      .set(auth())
      .send({
        kind: 'ADJUSTMENT',
        issue: true,
        items: [
          { item_type: 'SURCHARGE', description: 'Phụ thu vỡ ly', quantity: 2, unit_price_vnd: 50_000 },
          { item_type: 'DISCOUNT', description: 'Giảm giá thiện chí', quantity: 1, unit_price_vnd: -30_000 },
        ],
      })
      .expect(201);
    const inv = created.body.data;
    expect(inv.status).toBe('ISSUED');
    expect(inv.total_vnd).toBe(70_000); // 2×50k − 30k
    expect(inv.subtotal_vnd).toBe(100_000);
    expect(inv.discount_vnd).toBe(30_000);
    const number = inv.invoice_number;

    const voided = await request(http)
      .post(`/api/v1/invoices/${inv.id}/void`)
      .set(auth())
      .send({ reason: 'Ghi nhầm' })
      .expect(200);
    expect(voided.body.data.status).toBe('VOID');
    expect(voided.body.data.invoice_number).toBe(number); // giữ số
    expect(voided.body.data.void_reason).toBe('Ghi nhầm');

    // void lần 2 (terminal) → 422
    const again = await request(http).post(`/api/v1/invoices/${inv.id}/void`).set(auth()).send({ reason: 'x' });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('INVOICE_INVALID_STATUS');
  });
});
