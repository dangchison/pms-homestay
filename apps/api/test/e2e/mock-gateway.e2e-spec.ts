import 'reflect-metadata';
import { getQueueToken } from '@nestjs/bullmq';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type Queue } from 'bullmq';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUEUE_BILLING_GATEWAY } from '@core/bullmq/queues';
import { loadEnv } from '@core/config/env.schema';
import { BillingGatewayProcessor } from '@modules/subscription/billing-gateway.processor';
import { mockGatewayJobId } from '@modules/subscription/subscription.service';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';

/**
 * ★ Acceptance Đợt 4/M2 (docs/18 B4) — cổng thanh toán mock/sandbox billing SaaS:
 *  - BILLING_GATEWAY='manual' (mặc định): charge → PENDING + QR, KHÔNG enqueue,
 *    endpoint POST /public/billing/mock-gateway/:ref/pay → 404 (kể cả ref có thật).
 *  - BILLING_GATEWAY='mock': charge → 1 delayed job jobId=mock-gw__<id> (không ':'),
 *    delay=15000; process(job) trực tiếp (worker tắt) → CONFIRMED + tenant ACTIVE +
 *    gia hạn. Endpoint mock idempotent (không double-gia-hạn); ref sai → 404; rate-
 *    limit vượt ngưỡng cùng IP+ref → 429.
 *
 * Chạy sạch 1 spec (memory run-be-e2e-locally):
 *   (cd apps/api && LOG_LEVEL=fatal ENABLE_SCHEDULERS=false \
 *      pnpm exec vitest run test/e2e/mock-gateway.e2e-spec.ts)
 */

const PASSWORD = 'S3cure!Passw0rd-dev';

/** register owner + login → { token, tenantId }. */
async function bootstrapTenant(
  http: ReturnType<INestApplication['getHttpServer']>,
  admin: Client,
  slug: string,
  email: string,
): Promise<{ token: string; tenantId: string }> {
  await request(http)
    .post('/api/v1/auth/register')
    .send({
      tenant_slug: slug,
      tenant_display_name: 'MOCK-GW E2E',
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
  return { token, tenantId };
}

/** Dọn dữ liệu tenant (FK order) + đóng kết nối. subscription_payments cascade khi xoá tenant. */
async function cleanupTenant(admin: Client, slug: string): Promise<void> {
  const tid = `(SELECT id FROM tenants WHERE slug = '${slug}')`;
  await admin.query(`DELETE FROM guests WHERE tenant_id IN ${tid}`);
  await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
  await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
  await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
  await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
  // subscription_payments + audit_logs cascade khi xoá tenant (FK ON DELETE CASCADE).
  await admin.query(`DELETE FROM tenants WHERE slug = $1`, [slug]);
}

// ════════════════════════════════════════════════════════════════════════════
// (1) BILLING_GATEWAY='manual' — luồng hiện hữu không đổi: KHÔNG enqueue, 404 endpoint
// ════════════════════════════════════════════════════════════════════════════
describe('Mock-gateway M2 — mode MANUAL (không đổi luồng)', () => {
  const RUN = `${process.pid}${Date.now() % 100000}`;
  const slug = `mockgw-manual-${RUN}`;
  const email = `owner-manual-${RUN}@e2e.test`;

  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let queue: Queue;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    process.env.BILLING_GATEWAY = 'manual'; // TRƯỚC loadEnv() (pattern payment-reconcile)
    const env = loadEnv();
    expect(env.BILLING_GATEWAY).toBe('manual');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    queue = app.get<Queue>(getQueueToken(QUEUE_BILLING_GATEWAY));
    // Dọn job tồn dư từ lần chạy trước (crash) → assert "0 job" mode manual đáng tin.
    await queue.obliterate({ force: true }).catch(() => undefined);
    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();
    ({ token } = await bootstrapTenant(http, admin, slug, email));
  });

  afterAll(async () => {
    await app?.close();
    if (admin) {
      await cleanupTenant(admin, slug);
      await admin.end();
    }
  });

  it('charge STARTER → PENDING + QR, KHÔNG job nào trong queue billing-gateway', async () => {
    const res = await request(http)
      .post('/api/v1/billing/charge')
      .set(auth())
      .send({ plan_code: 'STARTER' })
      .expect(200);
    expect(res.body.data.payment.status).toBe('PENDING');
    expect(res.body.data.payment.payment_ref).toMatch(/^SUB-/);

    // mode manual KHÔNG chạm queue → 0 delayed/waiting.
    const counts = await queue.getJobCountByTypes('delayed', 'waiting');
    expect(counts).toBe(0);
  });

  it('endpoint mock-pay → 404 NOT_FOUND kể cả với paymentRef có thật (mode != mock)', async () => {
    const ref = (
      await request(http)
        .post('/api/v1/billing/charge')
        .set(auth())
        .send({ plan_code: 'STARTER' })
        .expect(200)
    ).body.data.payment.payment_ref as string;

    const res = await request(http)
      .post(`/api/v1/public/billing/mock-gateway/${ref}/pay`)
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (2) BILLING_GATEWAY='mock' — sandbox: delayed job + endpoint auto-confirm
// ════════════════════════════════════════════════════════════════════════════
describe('Mock-gateway M2 — mode MOCK (sandbox auto-confirm)', () => {
  const RUN = `${process.pid}${Date.now() % 100000}m`;
  const slug = `mockgw-mock-${RUN}`;
  const email = `owner-mock-${RUN}@e2e.test`;

  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let tenantId: string;
  let queue: Queue;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const charge = async (): Promise<{ id: string; ref: string }> => {
    const d = (
      await request(http)
        .post('/api/v1/billing/charge')
        .set(auth())
        .send({ plan_code: 'STARTER' })
        .expect(200)
    ).body.data.payment;
    return { id: d.id as string, ref: d.payment_ref as string };
  };

  const periodEndInDb = async (): Promise<string> =>
    (await admin.query(`SELECT current_period_end FROM tenants WHERE id = $1`, [tenantId])).rows[0]
      .current_period_end;

  const statusInDb = async (): Promise<string> =>
    (await admin.query(`SELECT status FROM tenants WHERE id = $1`, [tenantId])).rows[0].status;

  beforeAll(async () => {
    process.env.BILLING_GATEWAY = 'mock'; // TRƯỚC loadEnv()
    const env = loadEnv();
    expect(env.BILLING_GATEWAY).toBe('mock');
    expect(env.MOCK_GATEWAY_AUTOCONFIRM_SECONDS).toBe(15);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    queue = app.get<Queue>(getQueueToken(QUEUE_BILLING_GATEWAY));
    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();
    ({ token, tenantId } = await bootstrapTenant(http, admin, slug, email));
    // tenant mới = TRIAL; ép SUSPENDED để chứng minh confirm chuyển → ACTIVE.
    await admin.query(`UPDATE tenants SET status = 'SUSPENDED', suspended_at = now() WHERE id = $1`, [tenantId]);
  });

  afterAll(async () => {
    // Dọn job Redis của queue để không nhiễu lần chạy sau (jobId theo payment.id).
    await queue.obliterate({ force: true }).catch(() => undefined);
    await app?.close();
    if (admin) {
      await cleanupTenant(admin, slug);
      await admin.end();
    }
  });

  it('DI: app.get(BillingGatewayProcessor) resolve được (queue đăng ký OK)', () => {
    expect(app.get(BillingGatewayProcessor)).toBeInstanceOf(BillingGatewayProcessor);
  });

  it('charge STARTER → đúng 1 delayed job jobId=mock-gw__<id> (không ":"), delay=15000, data khớp', async () => {
    const { id } = await charge();

    const jobs = await queue.getDelayed();
    const job = jobs.find((j) => j.data?.paymentId === id);
    expect(job).toBeTruthy();
    expect(job!.id).toBe(mockGatewayJobId(id));
    expect(job!.id).toBe(`mock-gw__${id}`);
    expect(job!.id).not.toContain(':');
    expect(job!.opts.delay).toBe(15_000);
    expect(job!.data.paymentId).toBe(id);

    // Enqueue lại cùng payment → dedup theo jobId (vẫn đúng 1 job cho payment này).
    await app.get(BillingGatewayProcessor); // no-op resolve để chắc DI ổn
    const before = (await queue.getDelayed()).filter((j) => j.data?.paymentId === id).length;
    expect(before).toBe(1);
  });

  it('process(job) trực tiếp (worker tắt) → payment CONFIRMED + tenant ACTIVE + gia hạn', async () => {
    const { id } = await charge();
    const job = (await queue.getDelayed()).find((j) => j.data?.paymentId === id)!;
    expect(job).toBeTruthy();

    expect(await statusInDb()).toBe('SUSPENDED');
    const result = await app.get(BillingGatewayProcessor).process(job);
    expect(result.status).toBe('CONFIRMED');
    expect(await statusInDb()).toBe('ACTIVE');
    const sub = (await request(http).get('/api/v1/billing/subscription').set(auth()).expect(200)).body.data;
    expect(sub.status).toBe('ACTIVE');
    expect(sub.current_period_end).toBeTruthy();
  });

  it('endpoint mock-pay: lần 1 → 200 CONFIRMED; lần 2 cùng ref → 200 CONFIRMED KHÔNG double-gia-hạn', async () => {
    const { ref } = await charge();

    const first = await request(http)
      .post(`/api/v1/public/billing/mock-gateway/${ref}/pay`)
      .expect(200);
    expect(first.body.data.status).toBe('CONFIRMED');
    const endAfter1 = await periodEndInDb();

    const second = await request(http)
      .post(`/api/v1/public/billing/mock-gateway/${ref}/pay`)
      .expect(200);
    expect(second.body.data.status).toBe('CONFIRMED');
    const endAfter2 = await periodEndInDb();

    // Idempotent: gọi lại KHÔNG gia hạn thêm (current_period_end bằng nhau).
    expect(endAfter2).toEqual(endAfter1);
  });

  it('endpoint mock-pay: paymentRef không tồn tại → 404 SUBSCRIPTION_PAYMENT_NOT_FOUND', async () => {
    const res = await request(http)
      .post(`/api/v1/public/billing/mock-gateway/SUB-DOESNOTEXIST/pay`)
      .expect(404);
    expect(res.body.error.code).toBe('SUBSCRIPTION_PAYMENT_NOT_FOUND');
  });

  it('rate-limit: bắn quá ngưỡng cùng IP+ref liên tiếp → 429 RATE_LIMITED', async () => {
    const { ref } = await charge();
    let got429 = false;
    // Ngưỡng 10/60s/(IP,ref) → bắn 12 lần cùng ref chắc chắn chạm 429.
    for (let i = 0; i < 12; i++) {
      const res = await request(http).post(`/api/v1/public/billing/mock-gateway/${ref}/pay`);
      if (res.status === 429) {
        expect(res.body.error.code).toBe('RATE_LIMITED');
        got429 = true;
        break;
      }
    }
    expect(got429).toBe(true);
  });
});
