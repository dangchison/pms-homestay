import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request, { type Response as SuperResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance task 3.3 (docs/09 §5, ADR-0003 §1): POST /payments (cash, Idempotency-Key)
 * → trigger đẩy invoice PARTIALLY_PAID/PAID; cọc PAID → booking CONFIRMED; refund
 * một phần → paid_vnd/balance đúng công thức; VietQR động → PNG.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `pay-${RUN}`;

// supertest .parse nhận (res: Response, cb) nhưng runtime res là stream → cast.
const binaryParser = (res: SuperResponse, cb: (err: Error | null, body: Buffer) => void): void => {
  const chunks: Buffer[] = [];
  const stream = res as unknown as NodeJS.ReadableStream;
  stream.on('data', (c: Buffer) => chunks.push(c));
  stream.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Payments + VietQR (task 3.3)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let resDeposit: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const adhocInvoice = async (unitPrice: number): Promise<{ id: string; total: number }> => {
    const res = await request(http)
      .post('/api/v1/invoices')
      .set(auth())
      .send({
        kind: 'ADJUSTMENT',
        issue: true,
        items: [{ item_type: 'SURCHARGE', description: 'Dịch vụ thêm', quantity: 1, unit_price_vnd: unitPrice }],
      })
      .expect(201);
    return { id: res.body.data.id, total: res.body.data.total_vnd };
  };

  const pay = (invoiceId: string, amount: number, key = randomUUID()) =>
    request(http)
      .post('/api/v1/payments')
      .set({ ...auth(), 'Idempotency-Key': key })
      .send({ invoice_id: invoiceId, amount_vnd: amount, method: 'CASH' });

  const getInvoice = async (id: string) =>
    (await request(http).get(`/api/v1/invoices/${id}`).set(auth()).expect(200)).body.data;

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
        tenant_display_name: 'PAY E2E',
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
    // Cấu hình TK nhận tiền cho VietQR (chưa có API settings — set trực tiếp)
    await admin.query(
      `UPDATE properties SET bank_bin='970422', bank_account_number='0123456789', bank_account_name='HOMESTAY ABC' WHERE id=$1`,
      [propertyId],
    );
    const room1 = (
      await request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: '101' }).expect(201)
    ).body.data.id;
    resDeposit = (
      await request(http).get(`/api/v1/bookable-resources?property_id=${propertyId}`).set(auth()).expect(200)
    ).body.data.find((r: { room_ids: string[] }) => r.room_ids.includes(room1)).id;
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

  it('payment một phần → PARTIALLY_PAID; trả nốt → PAID (trigger paid_vnd)', async () => {
    const { id } = await adhocInvoice(200_000);
    await pay(id, 50_000).expect(201);
    let inv = await getInvoice(id);
    expect(inv.status).toBe('PARTIALLY_PAID');
    expect(inv.paid_vnd).toBe(50_000);
    expect(inv.balance_vnd).toBe(150_000);

    await pay(id, 150_000).expect(201);
    inv = await getInvoice(id);
    expect(inv.status).toBe('PAID');
    expect(inv.paid_vnd).toBe(200_000);
    expect(inv.balance_vnd).toBe(0);
  });

  it('★ refund một phần → công thức paid_vnd đúng (ADR-0003): paid/balance khớp', async () => {
    const { id } = await adhocInvoice(300_000);
    const p = await pay(id, 300_000).expect(201);
    expect((await getInvoice(id)).status).toBe('PAID');

    // hoàn 100k trên payment 300k
    const refunded = await request(http)
      .post(`/api/v1/payments/${p.body.data.id}/refund`)
      .set(auth())
      .send({ amount_vnd: 100_000, reason: 'Khách trả phòng sớm' })
      .expect(200);
    expect(refunded.body.data.status).toBe('PARTIALLY_REFUNDED');
    expect(refunded.body.data.refunded_amount_vnd).toBe(100_000);

    const inv = await getInvoice(id);
    expect(inv.paid_vnd).toBe(200_000); // 300k − 100k hoàn
    expect(inv.balance_vnd).toBe(100_000);
    expect(inv.status).toBe('PARTIALLY_PAID');
  });

  it('Idempotency-Key trùng → cùng payment, không cộng tiền hai lần', async () => {
    const { id } = await adhocInvoice(100_000);
    const key = randomUUID();
    const first = await pay(id, 100_000, key).expect(201);
    const replay = await pay(id, 100_000, key).expect(201);
    expect(replay.body.data.id).toBe(first.body.data.id);
    const inv = await getInvoice(id);
    expect(inv.paid_vnd).toBe(100_000); // không double
    const { rows } = await admin.query(`SELECT count(*)::int n FROM payments WHERE invoice_id = $1`, [id]);
    expect(rows[0].n).toBe(1);
  });

  it('★ thanh toán DEPOSIT invoice → booking tự CONFIRMED', async () => {
    const ci = '2027-04-01T07:00:00.000Z';
    const co = '2027-04-03T05:00:00.000Z';
    const q = (
      await request(http)
        .post('/api/v1/pricing/quote')
        .set(auth())
        .send({ resource_id: resDeposit, mode: 'DAILY', check_in: ci, check_out: co })
        .expect(200)
    ).body.data.quote_id;
    const bookingId = (
      await request(http)
        .post('/api/v1/bookings')
        .set({ ...auth(), 'Idempotency-Key': randomUUID() })
        .send({ resource_id: resDeposit, quote_id: q, mode: 'DAILY', check_in: ci, check_out: co })
        .expect(201)
    ).body.data.id;
    const deposit = (
      await request(http).get(`/api/v1/invoices?booking_id=${bookingId}`).set(auth()).expect(200)
    ).body.data[0];
    expect(deposit.kind).toBe('DEPOSIT');

    await pay(deposit.id, deposit.total_vnd).expect(201);
    expect((await request(http).get(`/api/v1/bookings/${bookingId}`).set(auth()).expect(200)).body.data.status).toBe(
      'CONFIRMED',
    );

    // VietQR PNG cho STAY sau check-out (invoice còn nợ) — dùng deposit đã PAID thì 422,
    // nên test QR trên một invoice ad-hoc gắn booking để còn balance:
    const qr = await request(http)
      .get(`/api/v1/invoices/${deposit.id}/qr-image`)
      .set(auth())
      .buffer(true)
      .parse(binaryParser);
    // deposit đã PAID → không còn số dư → 422
    expect(qr.status).toBe(422);
    expect(qr.body.toString()).toContain('INVOICE_NO_BALANCE');
  });

  it('VietQR qr-image → PNG hợp lệ cho invoice còn nợ', async () => {
    const ci = '2027-05-01T07:00:00.000Z';
    const co = '2027-05-03T05:00:00.000Z';
    const q = (
      await request(http)
        .post('/api/v1/pricing/quote')
        .set(auth())
        .send({ resource_id: resDeposit, mode: 'DAILY', check_in: ci, check_out: co })
        .expect(200)
    ).body.data.quote_id;
    const bookingId = (
      await request(http)
        .post('/api/v1/bookings')
        .set({ ...auth(), 'Idempotency-Key': randomUUID() })
        .send({ resource_id: resDeposit, quote_id: q, mode: 'DAILY', check_in: ci, check_out: co })
        .expect(201)
    ).body.data.id;
    const deposit = (
      await request(http).get(`/api/v1/invoices?booking_id=${bookingId}`).set(auth()).expect(200)
    ).body.data[0]; // DEPOSIT ISSUED, chưa trả → còn số dư

    const qr = await request(http)
      .get(`/api/v1/invoices/${deposit.id}/qr-image`)
      .set(auth())
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(qr.headers['content-type']).toMatch(/image\/png/);
    expect(qr.body.subarray(0, 4).toString('hex')).toBe('89504e47'); // PNG magic bytes
  });
});
