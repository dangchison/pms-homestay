import 'reflect-metadata';
import { createHmac, randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type PaymentWebhook } from '@pms/shared-types';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReconciliationService } from '@modules/payments/reconciliation.service';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance task 3.4 (docs/09 §5): webhook HMAC + dedup → 200; worker matching
 * confidence (code + amount khớp số dư → auto-confirm; thiếu mã/ambiguous → unmatched);
 * unmatched resolve. Worker tắt trong test → gọi ReconciliationService.reconcile trực tiếp.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `rec-${RUN}`;
const WEBHOOK_SECRET = `test-webhook-secret-${RUN}-0123456789`;
const BANK_ACCOUNT = '0123456789';
process.env.PAYMENT_WEBHOOK_SECRET = WEBHOOK_SECRET; // trước loadEnv() ở beforeAll

const sign = (body: string): string => createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

describe('Payment reconciliation — Casso/SePay webhook (task 3.4)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let resDeposit: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const postWebhook = (provider: string, payload: PaymentWebhook, signature?: string) => {
    const body = JSON.stringify(payload);
    return request(http)
      .post(`/api/v1/webhook/payment/${provider}`)
      .set('Content-Type', 'application/json')
      .set('x-signature', signature ?? sign(body))
      .send(body);
  };

  /** Đặt booking gói cọc 30% → trả {bookingId, bookingCode, depositAmount, depositId}. */
  const bookWithDeposit = async (ci: string, co: string) => {
    const q = (
      await request(http)
        .post('/api/v1/pricing/quote')
        .set(auth())
        .send({ resource_id: resDeposit, mode: 'DAILY', check_in: ci, check_out: co })
        .expect(200)
    ).body.data.quote_id;
    const booking = (
      await request(http)
        .post('/api/v1/bookings')
        .set({ ...auth(), 'Idempotency-Key': randomUUID() })
        .send({ resource_id: resDeposit, quote_id: q, mode: 'DAILY', check_in: ci, check_out: co })
        .expect(201)
    ).body.data;
    const deposit = (
      await request(http).get(`/api/v1/invoices?booking_id=${booking.id}`).set(auth()).expect(200)
    ).body.data[0];
    return {
      bookingId: booking.id as string,
      bookingCode: booking.booking_code as string,
      depositAmount: deposit.total_vnd as number,
      depositId: deposit.id as string,
    };
  };

  beforeAll(async () => {
    const env = loadEnv();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true, rawBody: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();

    await request(http)
      .post('/api/v1/auth/register')
      .send({
        tenant_slug: tenantSlug,
        tenant_display_name: 'REC E2E',
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
    await admin.query(
      `UPDATE properties SET bank_bin='970422', bank_account_number=$2, bank_account_name='ABC' WHERE id=$1`,
      [propertyId, BANK_ACCOUNT],
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
      await admin.query(`DELETE FROM webhook_events_received WHERE event_id LIKE 'evt-${RUN}%'`);
      await admin.query(`DELETE FROM unmatched_payments WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM payment_attempts WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM payments WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM invoice_items WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM invoices WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM room_occupancy WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM booking_status_history WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM quotes WHERE tenant_id IN ${tid}`);
      // booking CONFIRMED (auto-confirm/resolve) phát outbound_messages (kênh EMAIL) gắn
      // booking_id → xoá trước bookings (FK (tenant_id, booking_id)).
      await admin.query(`DELETE FROM outbound_messages WHERE tenant_id IN ${tid}`);
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
      // booking CONFIRMED (auto-confirm/resolve) phát notification → xoá trước users (FK user_id).
      await admin.query(`DELETE FROM notifications WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await app?.close();
  });

  it('chữ ký HMAC sai → 401', async () => {
    const payload: PaymentWebhook = { event_id: `evt-${RUN}-bad`, amount_vnd: 100_000, content: 'x', bank_account: BANK_ACCOUNT };
    const res = await postWebhook('casso', payload, 'deadbeef');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('WEBHOOK_BAD_SIGNATURE');
  });

  it('★ webhook khớp mã + số tiền → auto-confirm payment → booking CONFIRMED', async () => {
    const bk = await bookWithDeposit('2027-06-01T07:00:00.000Z', '2027-06-03T05:00:00.000Z');
    const payload: PaymentWebhook = {
      event_id: `evt-${RUN}-ok`,
      amount_vnd: bk.depositAmount, // == số dư DEPOSIT invoice
      content: `Thanh toan coc ${bk.bookingCode} cam on`,
      bank_account: BANK_ACCOUNT,
    };
    const res = await postWebhook('casso', payload).expect(200);
    expect(res.body).toMatchObject({ received: true, duplicate: false });

    // worker tắt trong test → chạy đối soát trực tiếp
    const result = await app.get(ReconciliationService).reconcile('casso', payload);
    expect(result.matched).toBe(true);

    const inv = (await request(http).get(`/api/v1/invoices/${bk.depositId}`).set(auth()).expect(200)).body.data;
    expect(inv.status).toBe('PAID');
    expect(inv.paid_vnd).toBe(bk.depositAmount);
    const booking = (await request(http).get(`/api/v1/bookings/${bk.bookingId}`).set(auth()).expect(200)).body.data;
    expect(booking.status).toBe('CONFIRMED');
  });

  it('webhook trùng event_id → duplicate=true (dedup)', async () => {
    const payload: PaymentWebhook = { event_id: `evt-${RUN}-dup`, amount_vnd: 50_000, content: 'no code', bank_account: BANK_ACCOUNT };
    expect((await postWebhook('casso', payload).expect(200)).body.duplicate).toBe(false);
    expect((await postWebhook('casso', payload).expect(200)).body.duplicate).toBe(true);
  });

  it('★ không có mã (ambiguous) → unmatched → resolve tay tạo payment', async () => {
    const bk = await bookWithDeposit('2027-07-01T07:00:00.000Z', '2027-07-03T05:00:00.000Z');
    const payload: PaymentWebhook = {
      event_id: `evt-${RUN}-amb`,
      amount_vnd: bk.depositAmount,
      content: 'chuyen khoan khong ghi noi dung', // không có mã BK/INV
      bank_account: BANK_ACCOUNT,
    };
    await postWebhook('casso', payload).expect(200);
    const result = await app.get(ReconciliationService).reconcile('casso', payload);
    expect(result.matched).toBe(false);

    const unmatched = (await request(http).get('/api/v1/payments/unmatched').set(auth()).expect(200)).body.data as Array<{
      id: string;
      transaction_ref: string;
      amount_vnd: number;
      status: string;
    }>;
    const um = unmatched.find((u) => u.transaction_ref === payload.event_id)!;
    expect(um).toBeTruthy();
    expect(um.amount_vnd).toBe(bk.depositAmount);

    // resolve thủ công vào DEPOSIT invoice của booking → tạo payment → RESOLVED + booking CONFIRMED
    const resolved = await request(http)
      .post(`/api/v1/payments/unmatched/${um.id}/resolve`)
      .set(auth())
      .send({ invoice_id: bk.depositId })
      .expect(200);
    expect(resolved.body.data.status).toBe('RESOLVED');

    const inv = (await request(http).get(`/api/v1/invoices/${bk.depositId}`).set(auth()).expect(200)).body.data;
    expect(inv.status).toBe('PAID');
    const booking = (await request(http).get(`/api/v1/bookings/${bk.bookingId}`).set(auth()).expect(200)).body.data;
    expect(booking.status).toBe('CONFIRMED');
  });
});
