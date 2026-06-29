import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';
import { TenantStatusService } from '@core/tenancy/tenant-status.service';
import { SubscriptionService } from '@modules/subscription/subscription.service';

/**
 * ★ Acceptance task 4.7 (docs/02 §6, docs/14 §4.7):
 *  - Plan-limit guard: tạo property/room vượt subscription_plans.max_* → 422 PLAN_LIMIT_REACHED.
 *  - Trang billing: GET /billing/subscription (gói + usage) · GET /billing/payments.
 *  - Thu phí VietQR động (POST /billing/charge) + platform admin xác nhận (secret) → ACTIVE.
 *  - Cron lifecycle: TRIAL/ACTIVE hết hạn → SUSPENDED (chặn write, cho đọc) → 60 ngày → CHURNED.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `billing-${RUN}`;
const ownerEmail = `owner-${RUN}@e2e.test`;
const platformEmail = `padmin-billing-${RUN}@platform.test`;

describe('Billing-lite SaaS (task 4.7)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let platformToken: string;
  let tenantId: string;
  let propertyId: string;
  let starterPaymentId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  // B4: confirm thuê bao bảo vệ bằng platform-auth (thay PLATFORM_ADMIN_SECRET).
  const platformAuth = () => ({ Authorization: `Bearer ${platformToken}` });
  const subscription = () => app.get(SubscriptionService);
  const tenantStatus = () => app.get(TenantStatusService);

  const createProperty = (name: string) =>
    request(http)
      .post('/api/v1/properties')
      .set(auth())
      .send({ name, property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' });

  const createRoom = (num: string) =>
    request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: num });

  const tenantStatusInDb = async (): Promise<string> =>
    (await admin.query(`SELECT status FROM tenants WHERE id = $1`, [tenantId])).rows[0].status;

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
        tenant_display_name: 'BILLING E2E',
        email: ownerEmail,
        password: PASSWORD,
        full_name: 'Owner',
      })
      .expect(201);
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id;
    token = (
      await request(http)
        .post('/api/v1/auth/login')
        .set('X-Tenant-Slug', tenantSlug)
        .send({ email: ownerEmail, password: PASSWORD })
        .expect(200)
    ).body.data.access_token;

    // Platform admin (B4) — seed platform_users + đăng nhập để confirm thuê bao.
    const phash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    await admin.query(
      `INSERT INTO platform_users (email, password_hash, full_name, is_active) VALUES ($1,$2,'Billing Admin',true)`,
      [platformEmail, phash],
    );
    platformToken = (
      await request(http)
        .post('/api/v1/platform/auth/login')
        .send({ email: platformEmail, password: PASSWORD })
        .expect(200)
    ).body.data.access_token;
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM resource_members WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM bookable_resources WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM rooms WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM guests WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      // platform_users là bảng global (không tenant) → xoá tường minh theo email.
      await admin.query(`DELETE FROM platform_users WHERE email = $1`, [platformEmail]);
      // subscription_payments + audit_logs tự cascade khi xoá tenant (FK ON DELETE CASCADE).
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await app?.close();
  });

  it('plan-limit property: gói FREE (max 1) → property thứ 2 → 422 PLAN_LIMIT_REACHED', async () => {
    propertyId = (await createProperty('P1').expect(201)).body.data.id;
    const res = await createProperty('P2').expect(422);
    expect(res.body.error.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('plan-limit room: gói FREE (max 5) → phòng thứ 6 → 422', async () => {
    for (let i = 1; i <= 5; i++) await createRoom(`10${i}`).expect(201);
    const res = await createRoom('106').expect(422);
    expect(res.body.error.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('GET /billing/subscription: gói FREE + status TRIAL + usage đúng', async () => {
    const res = await request(http).get('/api/v1/billing/subscription').set(auth()).expect(200);
    const d = res.body.data;
    expect(d.status).toBe('TRIAL');
    expect(d.plan.code).toBe('FREE');
    expect(d.plan.max_properties).toBe(1);
    expect(d.usage).toEqual({ properties: 1, rooms: 5, users: 1 });
    expect(d.trial_ends_at).toBeTruthy();
  });

  it('charge: gói FREE (giá 0) → 422; gói STARTER → VietQR động + payment PENDING', async () => {
    await request(http)
      .post('/api/v1/billing/charge')
      .set(auth())
      .send({ plan_code: 'FREE' })
      .expect(422);

    const res = await request(http)
      .post('/api/v1/billing/charge')
      .set(auth())
      .send({ plan_code: 'STARTER' })
      .expect(200);
    const d = res.body.data;
    expect(d.payment.status).toBe('PENDING');
    expect(d.payment.amount_vnd).toBe(199_000);
    expect(d.payment.payment_ref).toMatch(/^SUB-/);
    expect(d.qr.payload).toMatch(/^000201/); // EMVCo payload indicator
    expect(d.qr.amount_vnd).toBe(199_000);
    starterPaymentId = d.payment.id;
  });

  it('GET /billing/payments: chứa payment PENDING vừa tạo', async () => {
    const res = await request(http).get('/api/v1/billing/payments').set(auth()).expect(200);
    const found = (res.body.data as { id: string; status: string }[]).find((p) => p.id === starterPaymentId);
    expect(found?.status).toBe('PENDING');
  });

  it('platform confirm: không token → 401; token platform → ACTIVE + plan STARTER + nâng giới hạn', async () => {
    await request(http)
      .post(`/api/v1/platform/subscription-payments/${starterPaymentId}/confirm`)
      .expect(401);

    const ok = await request(http)
      .post(`/api/v1/platform/subscription-payments/${starterPaymentId}/confirm`)
      .set(platformAuth())
      .expect(200);
    expect(ok.body.data.status).toBe('CONFIRMED');

    const sub = (await request(http).get('/api/v1/billing/subscription').set(auth()).expect(200)).body.data;
    expect(sub.status).toBe('ACTIVE');
    expect(sub.plan.code).toBe('STARTER');
    expect(sub.current_period_end).toBeTruthy();

    // Giới hạn nâng lên STARTER (max 2) → property thứ 2 giờ tạo được.
    await createProperty('P2-after-upgrade').expect(201);
  });

  it('lifecycle: ACTIVE hết hạn → SUSPENDED (chặn write, cho đọc); charge vẫn được rồi kích hoạt lại', async () => {
    await admin.query(`UPDATE tenants SET current_period_end = now() - interval '1 day' WHERE id = $1`, [tenantId]);
    const swept = await subscription().runLifecycleSweep(new Date());
    expect(swept.suspended).toBeGreaterThanOrEqual(1);
    expect(await tenantStatusInDb()).toBe('SUSPENDED');
    await tenantStatus().invalidate(tenantId); // cron prod đợi TTL; test ép tươi

    // SUSPENDED: đọc OK, write bị chặn.
    await request(http).get('/api/v1/guests').set(auth()).expect(200);
    const blocked = await request(http)
      .post('/api/v1/guests')
      .set(auth())
      .send({ full_name: 'Khách A' })
      .expect(403);
    expect(blocked.body.error.code).toBe('TENANT_SUSPENDED');

    // charge vẫn cho phép (@AllowSuspended) → confirm → ACTIVE → write mở lại.
    const charge = await request(http)
      .post('/api/v1/billing/charge')
      .set(auth())
      .send({ plan_code: 'STARTER' })
      .expect(200);
    await request(http)
      .post(`/api/v1/platform/subscription-payments/${charge.body.data.payment.id}/confirm`)
      .set(platformAuth())
      .expect(200);
    expect(await tenantStatusInDb()).toBe('ACTIVE');
    await request(http).post('/api/v1/guests').set(auth()).send({ full_name: 'Khách B' }).expect(201);
  });

  it('lifecycle: SUSPENDED quá 60 ngày → CHURNED → mọi truy cập tenant 403 TENANT_CHURNED', async () => {
    await admin.query(
      `UPDATE tenants SET status = 'SUSPENDED', suspended_at = now() - interval '61 days' WHERE id = $1`,
      [tenantId],
    );
    const swept = await subscription().runLifecycleSweep(new Date());
    expect(swept.churned).toBeGreaterThanOrEqual(1);
    expect(await tenantStatusInDb()).toBe('CHURNED');
    await tenantStatus().invalidate(tenantId);

    const res = await request(http).get('/api/v1/guests').set(auth()).expect(403);
    expect(res.body.error.code).toBe('TENANT_CHURNED');
  });
});
