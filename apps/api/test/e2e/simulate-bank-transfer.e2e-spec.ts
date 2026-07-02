import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { envSchema, loadEnv } from '@core/config/env.schema';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';

/**
 * ★ Acceptance Đợt 4/M4 (docs/18) — Bank transfer simulator dev-only khép vòng đối
 * soát demo hosted booking. Mirror payment-reconcile (setup tenant/property/rate-plan
 * cọc/booking) + mock-gateway (toggle env flag TRƯỚC loadEnv, 2 app on/off).
 *
 *  - DEMO_TOOLS_ENABLED='true': POST /api/v1/dev/simulate-bank-transfer khớp mã BK-
 *    + số dư → 200 matched=true → DEPOSIT invoice PAID + booking CONFIRMED (đối soát
 *    chạy ĐỒNG BỘ trong 1 request vì worker off); content chứa INV- → PAID; content
 *    không mã → matched=false + có unmatched_payments (không auto-confirm sai); vượt
 *    ngưỡng cùng (IP, event_id) → 429 RATE_LIMITED.
 *  - DEMO_TOOLS_ENABLED off/'false': cùng payload hợp lệ → 404 NOT_FOUND + KHÔNG tạo
 *    payment/unmatched (chứng minh endpoint vô hình, an toàn prod).
 *  - env-validation: giá trị lạ ('yes') → schema từ chối; không set → false (boolean).
 *
 * Chạy sạch 1 spec (memory run-be-e2e-locally):
 *   (cd apps/api && LOG_LEVEL=fatal ENABLE_SCHEDULERS=false \
 *      pnpm exec vitest run test/e2e/simulate-bank-transfer.e2e-spec.ts)
 */

const PASSWORD = 'S3cure!Passw0rd-dev';
const WEBHOOK_SECRET = 'test-webhook-secret-m4-0123456789';

interface Ctx {
  http: ReturnType<INestApplication['getHttpServer']>;
  admin: Client;
  token: string;
  tenantId: string;
  bankAccount: string;
  resource: string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** register owner + property(bank_account_number) + rate-plan cọc 30% + resource. */
async function setupTenant(
  http: Ctx['http'],
  admin: Client,
  slug: string,
  email: string,
  bankAccount: string,
): Promise<{ token: string; tenantId: string; resource: string }> {
  await request(http)
    .post('/api/v1/auth/register')
    .send({
      tenant_slug: slug,
      tenant_display_name: 'M4 E2E',
      email,
      password: PASSWORD,
      full_name: 'Owner',
    })
    .expect(201);
  const tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [slug])).rows[0].id;
  const token = (
    await request(http)
      .post('/api/v1/auth/login')
      .set('X-Tenant-Slug', slug)
      .send({ email, password: PASSWORD })
      .expect(200)
  ).body.data.access_token;

  const propertyId = (
    await request(http)
      .post('/api/v1/properties')
      .set(auth(token))
      .send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' })
      .expect(201)
  ).body.data.id;
  await admin.query(
    `UPDATE properties SET bank_bin='970422', bank_account_number=$2, bank_account_name='ABC' WHERE id=$1`,
    [propertyId, bankAccount],
  );
  const room1 = (
    await request(http)
      .post('/api/v1/rooms')
      .set(auth(token))
      .send({ property_id: propertyId, room_number: '101' })
      .expect(201)
  ).body.data.id;
  const resource = (
    await request(http)
      .get(`/api/v1/bookable-resources?property_id=${propertyId}`)
      .set(auth(token))
      .expect(200)
  ).body.data.find((r: { room_ids: string[] }) => r.room_ids.includes(room1)).id;
  await request(http)
    .post('/api/v1/rate-plans')
    .set(auth(token))
    .send({
      property_id: propertyId,
      name: 'Cọc 30%',
      mode: 'DAILY',
      base_price_vnd: 500_000,
      effective_from: '2026-01-01',
      deposit_type: 'PERCENT',
      deposit_value: 3000,
      resource_ids: [resource],
    })
    .expect(201);
  return { token, tenantId, resource };
}

/** Đặt booking gói cọc 30% → {bookingId, bookingCode, depositAmount, depositId, invoiceNumber}. */
async function bookWithDeposit(ctx: Ctx, ci: string, co: string) {
  const q = (
    await request(ctx.http)
      .post('/api/v1/pricing/quote')
      .set(auth(ctx.token))
      .send({ resource_id: ctx.resource, mode: 'DAILY', check_in: ci, check_out: co })
      .expect(200)
  ).body.data.quote_id;
  const booking = (
    await request(ctx.http)
      .post('/api/v1/bookings')
      .set({ ...auth(ctx.token), 'Idempotency-Key': randomUUID() })
      .send({ resource_id: ctx.resource, quote_id: q, mode: 'DAILY', check_in: ci, check_out: co })
      .expect(201)
  ).body.data;
  const deposit = (
    await request(ctx.http).get(`/api/v1/invoices?booking_id=${booking.id}`).set(auth(ctx.token)).expect(200)
  ).body.data[0];
  return {
    bookingId: booking.id as string,
    bookingCode: booking.booking_code as string,
    depositAmount: deposit.total_vnd as number,
    depositId: deposit.id as string,
    invoiceNumber: deposit.invoice_number as string,
  };
}

/** Dọn dữ liệu tenant theo FK order (mirror payment-reconcile). */
async function cleanupTenant(admin: Client, slug: string): Promise<void> {
  const tid = `(SELECT id FROM tenants WHERE slug = '${slug}')`;
  await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
  await admin.query(`DELETE FROM unmatched_payments WHERE tenant_id IN ${tid}`);
  await admin.query(`DELETE FROM payment_attempts WHERE tenant_id IN ${tid}`);
  await admin.query(`DELETE FROM payments WHERE tenant_id IN ${tid}`);
  await admin.query(`DELETE FROM invoice_items WHERE tenant_id IN ${tid}`);
  await admin.query(`DELETE FROM invoices WHERE tenant_id IN ${tid}`);
  await admin.query(`DELETE FROM room_occupancy WHERE tenant_id IN ${tid}`);
  await admin.query(`DELETE FROM booking_status_history WHERE tenant_id IN ${tid}`);
  await admin.query(`DELETE FROM quotes WHERE tenant_id IN ${tid}`);
  // booking CONFIRMED (đối soát đồng bộ) phát outbound_messages (kênh EMAIL) gắn
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
  // booking CONFIRMED (đối soát đồng bộ) phát notification → xoá trước users (FK user_id).
  await admin.query(`DELETE FROM notifications WHERE tenant_id IN ${tid}`);
  await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
  // webhook_events_received không RLS (no tenant_id gốc) → dọn theo tenant đã set khi processed.
  await admin.query(`DELETE FROM webhook_events_received WHERE tenant_id IN ${tid}`);
  await admin.query(`DELETE FROM tenants WHERE slug = $1`, [slug]);
}

// ════════════════════════════════════════════════════════════════════════════
// (1) DEMO_TOOLS_ENABLED='true' — endpoint mở: khép vòng đối soát demo đồng bộ
// ════════════════════════════════════════════════════════════════════════════
describe('Simulate bank transfer M4 — FLAG ON (DEMO_TOOLS_ENABLED=true)', () => {
  const RUN = `${process.pid}${Date.now() % 100000}on`;
  const slug = `simck-on-${RUN}`;
  const email = `owner-on-${RUN}@e2e.test`;
  const bankAccount = `9${RUN}`.slice(0, 20);

  let app: INestApplication;
  let ctx: Ctx;
  let prevFlag: string | undefined;

  const simulate = (body: Record<string, unknown>) =>
    request(ctx.http).post('/api/v1/dev/simulate-bank-transfer').send(body);

  beforeAll(async () => {
    prevFlag = process.env.DEMO_TOOLS_ENABLED;
    process.env.DEMO_TOOLS_ENABLED = 'true'; // TRƯỚC loadEnv() (pattern mock-gateway)
    process.env.PAYMENT_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const env = loadEnv();
    expect(env.DEMO_TOOLS_ENABLED).toBe(true);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true, rawBody: true });
    configureApp(app);
    await app.init();
    const admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();
    const http = app.getHttpServer();
    const { token, tenantId, resource } = await setupTenant(http, admin, slug, email, bankAccount);
    ctx = { http, admin, token, tenantId, resource, bankAccount };
  });

  afterAll(async () => {
    await app?.close();
    if (ctx?.admin) {
      await cleanupTenant(ctx.admin, slug);
      await ctx.admin.end();
    }
    if (prevFlag === undefined) delete process.env.DEMO_TOOLS_ENABLED;
    else process.env.DEMO_TOOLS_ENABLED = prevFlag;
  });

  it('★ khớp mã BK- + số dư → 200 matched=true → invoice PAID + booking CONFIRMED', async () => {
    const bk = await bookWithDeposit(ctx, '2027-06-01T07:00:00.000Z', '2027-06-03T05:00:00.000Z');
    const res = await simulate({
      bank_account: ctx.bankAccount,
      amount_vnd: bk.depositAmount,
      content: `Thanh toan coc ${bk.bookingCode} cam on`,
    }).expect(200);
    expect(res.body.data.matched).toBe(true);
    expect(res.body.data.event_id).toBeTruthy();

    const inv = (await request(ctx.http).get(`/api/v1/invoices/${bk.depositId}`).set(auth(ctx.token)).expect(200))
      .body.data;
    expect(inv.status).toBe('PAID');
    expect(inv.paid_vnd).toBe(bk.depositAmount);
    const booking = (
      await request(ctx.http).get(`/api/v1/bookings/${bk.bookingId}`).set(auth(ctx.token)).expect(200)
    ).body.data;
    expect(booking.status).toBe('CONFIRMED');
  });

  it('★ content chứa INV- (invoice_number) + số dư → 200 matched=true → invoice PAID', async () => {
    const bk = await bookWithDeposit(ctx, '2027-08-01T07:00:00.000Z', '2027-08-03T05:00:00.000Z');
    const res = await simulate({
      bank_account: ctx.bankAccount,
      amount_vnd: bk.depositAmount,
      invoice_number: bk.invoiceNumber, // tự dựng content chứa INV-
    }).expect(200);
    expect(res.body.data.matched).toBe(true);

    const inv = (await request(ctx.http).get(`/api/v1/invoices/${bk.depositId}`).set(auth(ctx.token)).expect(200))
      .body.data;
    expect(inv.status).toBe('PAID');
  });

  it('★ content không có mã BK-/INV- → 200 matched=false + có unmatched, invoice CHƯA PAID', async () => {
    const bk = await bookWithDeposit(ctx, '2027-09-01T07:00:00.000Z', '2027-09-03T05:00:00.000Z');
    const res = await simulate({
      bank_account: ctx.bankAccount,
      amount_vnd: bk.depositAmount,
      content: 'chuyen khoan khong ghi noi dung',
    }).expect(200);
    expect(res.body.data.matched).toBe(false);
    const eventId = res.body.data.event_id as string;

    const unmatched = (
      await request(ctx.http).get('/api/v1/payments/unmatched').set(auth(ctx.token)).expect(200)
    ).body.data as Array<{ transaction_ref: string; amount_vnd: number }>;
    const um = unmatched.find((u) => u.transaction_ref === eventId);
    expect(um).toBeTruthy();
    expect(um!.amount_vnd).toBe(bk.depositAmount);

    // KHÔNG auto-confirm sai → invoice vẫn chưa PAID.
    const inv = (await request(ctx.http).get(`/api/v1/invoices/${bk.depositId}`).set(auth(ctx.token)).expect(200))
      .body.data;
    expect(inv.status).not.toBe('PAID');
  });

  it('★ vượt ngưỡng rate-limit cùng (IP, event_id) → 429 RATE_LIMITED', async () => {
    const eventId = `rl-${RUN}`; // CỐ ĐỊNH event_id → cùng key (IP, event_id) mỗi lần.
    let got429 = false;
    // Ngưỡng 10/60s → bắn 12 lần cùng event_id chắc chắn chạm 429.
    for (let i = 0; i < 12; i++) {
      const res = await simulate({
        bank_account: ctx.bankAccount,
        amount_vnd: 100_000,
        content: 'chuyen khoan',
        event_id: eventId,
      });
      if (res.status === 429) {
        expect(res.body.error.code).toBe('RATE_LIMITED');
        got429 = true;
        break;
      }
    }
    expect(got429).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (2) DEMO_TOOLS_ENABLED off/'false' — HARD-GATE: 404 + KHÔNG tạo dữ liệu
// ════════════════════════════════════════════════════════════════════════════
describe('Simulate bank transfer M4 — FLAG OFF (DEMO_TOOLS_ENABLED=false)', () => {
  const RUN = `${process.pid}${Date.now() % 100000}off`;
  const slug = `simck-off-${RUN}`;
  const email = `owner-off-${RUN}@e2e.test`;
  const bankAccount = `8${RUN}`.slice(0, 20);

  let app: INestApplication;
  let ctx: Ctx;
  let prevFlag: string | undefined;

  beforeAll(async () => {
    prevFlag = process.env.DEMO_TOOLS_ENABLED;
    process.env.DEMO_TOOLS_ENABLED = 'false'; // tường minh 'false' (chuỗi) → phải ra boolean false
    process.env.PAYMENT_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const env = loadEnv();
    expect(env.DEMO_TOOLS_ENABLED).toBe(false);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true, rawBody: true });
    configureApp(app);
    await app.init();
    const admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();
    const http = app.getHttpServer();
    const { token, tenantId, resource } = await setupTenant(http, admin, slug, email, bankAccount);
    ctx = { http, admin, token, tenantId, resource, bankAccount };
  });

  afterAll(async () => {
    await app?.close();
    if (ctx?.admin) {
      await cleanupTenant(ctx.admin, slug);
      await ctx.admin.end();
    }
    if (prevFlag === undefined) delete process.env.DEMO_TOOLS_ENABLED;
    else process.env.DEMO_TOOLS_ENABLED = prevFlag;
  });

  it('payload HỢP LỆ (bank_account + mã BK- có thật) → 404 NOT_FOUND + KHÔNG tạo payment/unmatched', async () => {
    const bk = await bookWithDeposit(ctx, '2027-10-01T07:00:00.000Z', '2027-10-03T05:00:00.000Z');
    const res = await request(ctx.http)
      .post('/api/v1/dev/simulate-bank-transfer')
      .send({
        bank_account: ctx.bankAccount,
        amount_vnd: bk.depositAmount,
        content: `Thanh toan coc ${bk.bookingCode}`,
      })
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    // Endpoint vô hình → KHÔNG có bất kỳ payment/unmatched nào cho tenant này (assert DB).
    const tid = `(SELECT id FROM tenants WHERE slug = '${slug}')`;
    const payments = await ctx.admin.query(`SELECT count(*)::int AS n FROM payments WHERE tenant_id IN ${tid}`);
    expect(payments.rows[0].n).toBe(0);
    const unmatched = await ctx.admin.query(
      `SELECT count(*)::int AS n FROM unmatched_payments WHERE tenant_id IN ${tid}`,
    );
    expect(unmatched.rows[0].n).toBe(0);

    // Booking vẫn PENDING (chưa CONFIRMED) — không có đối soát nào xảy ra.
    const booking = (
      await request(ctx.http).get(`/api/v1/bookings/${bk.bookingId}`).set(auth(ctx.token)).expect(200)
    ).body.data;
    expect(booking.status).not.toBe('CONFIRMED');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (3) ENV validation — enum(['true','false']).transform (KHÔNG coerce boolean)
// ════════════════════════════════════════════════════════════════════════════
describe('Simulate bank transfer M4 — ENV validation DEMO_TOOLS_ENABLED', () => {
  /** Base env đủ field bắt buộc để chỉ DEMO_TOOLS_ENABLED biến thiên. */
  const baseEnv = (): Record<string, string> => ({
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://app_user:app_password@localhost:5432/pms',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379/0',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
    JWT_REFRESH_SECRET: 'y'.repeat(32),
    PII_ENC_KEY_CURRENT: 'k1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    PII_HMAC_KEY: 'z'.repeat(32),
    S3_ENDPOINT: 'http://localhost:9000',
    S3_BUCKET: 'b',
    S3_ACCESS_KEY: 'a',
    S3_SECRET_KEY: 's',
  });

  it("giá trị lạ ('yes') → schema từ chối (KHÔNG âm thầm bật)", () => {
    expect(() => envSchema.parse({ ...baseEnv(), DEMO_TOOLS_ENABLED: 'yes' })).toThrow();
    expect(() => envSchema.parse({ ...baseEnv(), DEMO_TOOLS_ENABLED: '1' })).toThrow();
  });

  it("'false' (chuỗi) → boolean false (KHÔNG bị coi là true như coerce)", () => {
    expect(envSchema.parse({ ...baseEnv(), DEMO_TOOLS_ENABLED: 'false' }).DEMO_TOOLS_ENABLED).toBe(false);
  });

  it('không set biến → false (boolean, mặc định an toàn)', () => {
    const parsed = envSchema.parse(baseEnv());
    expect(parsed.DEMO_TOOLS_ENABLED).toBe(false);
    expect(typeof parsed.DEMO_TOOLS_ENABLED).toBe('boolean');
  });

  it("'true' → boolean true", () => {
    expect(envSchema.parse({ ...baseEnv(), DEMO_TOOLS_ENABLED: 'true' }).DEMO_TOOLS_ENABLED).toBe(true);
  });
});
