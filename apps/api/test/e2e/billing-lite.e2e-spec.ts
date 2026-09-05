import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { PlanFeatureService } from '@core/billing/plan-feature.service';
import { loadEnv } from '@core/config/env.schema';
import { TenantStatusService } from '@core/tenancy/tenant-status.service';
import { SubscriptionService } from '@modules/subscription/subscription.service';

/**
 * ★ Acceptance task 4.7 (docs/02 §6, docs/14 §4.7) + bộ gói chốt 2026-08-11:
 *  - Plan-limit guard: tạo property/room vượt subscription_plans.max_* → 422 PLAN_LIMIT_REACHED.
 *  - Trần phòng TỪNG cơ sở (max_rooms_per_property, migration 0036) tách khỏi trần tổng.
 *  - Trang billing: GET /billing/subscription (gói + usage) · GET /billing/payments.
 *  - Thu phí VietQR động (POST /billing/charge) + platform admin xác nhận → ACTIVE.
 *  - PlanFeatureGuard: tính năng ngoài gói → 402 PLAN_FEATURE_REQUIRED.
 *  - Bảng giá công khai: GET /public/plans không cần token.
 *  - Cron lifecycle: TRIAL hết hạn → HẠ VỀ FREE (không khoá); ACTIVE hết hạn thuê bao
 *    → SUSPENDED (chặn write, cho đọc) → 60 ngày → CHURNED.
 *
 * Đăng ký = trial 14 ngày ở hạn mức STARTER (1 cơ sở · 15 phòng/cơ sở · 15 phòng tổng).
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `billing-${RUN}`;
const ownerEmail = `owner-${RUN}@e2e.test`;
const platformEmail = `padmin-billing-${RUN}@platform.test`;
/** Tenant thứ hai, chỉ dùng cho kịch bản hết hạn dùng thử. */
const trialSlug = `billing-trial-${RUN}`;
const trialEmail = `owner-trial-${RUN}@e2e.test`;

describe('Billing-lite SaaS (task 4.7)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let platformToken: string;
  let tenantId: string;
  let propertyId: string;
  let secondPropertyId: string;
  let proPaymentId: string;

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

  const createRoom = (num: string, propId = propertyId) =>
    request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propId, room_number: num });

  const tenantStatusInDb = async (): Promise<string> =>
    (await admin.query(`SELECT status FROM tenants WHERE id = $1`, [tenantId])).rows[0].status;

  /**
   * Nhồi phòng thẳng vào DB (bỏ qua API) để chạm trần nhanh — guard chỉ đếm bản ghi
   * `rooms`, không quan tâm bookable_resource đi kèm. 25 lượt POST cho mỗi ca kiểm
   * trần là quá chậm.
   */
  const seedRooms = async (propId: string, count: number, prefix: string): Promise<void> => {
    for (let i = 0; i < count; i++) {
      await admin.query(
        `INSERT INTO rooms (tenant_id, property_id, room_number) VALUES ($1, $2, $3)`,
        [tenantId, propId, `${prefix}${i}`],
      );
    }
  };

  /** Ép gói của tenant + xoá cache để guard đọc gói mới ngay trong test. */
  const setPlan = async (code: string): Promise<void> => {
    await admin.query(
      `UPDATE tenants SET subscription_plan_id = (SELECT id FROM subscription_plans WHERE code = $2) WHERE id = $1`,
      [tenantId, code],
    );
    await app.get(PlanFeatureService).invalidate(tenantId);
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
      for (const slug of [tenantSlug, trialSlug]) {
        const tid = `(SELECT id FROM tenants WHERE slug = '${slug}')`;
        await admin.query(`DELETE FROM resource_members WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM bookable_resources WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM rooms WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM guests WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
        // subscription_payments + audit_logs tự cascade khi xoá tenant (FK ON DELETE CASCADE).
        await admin.query(`DELETE FROM tenants WHERE slug = $1`, [slug]);
      }
      // platform_users là bảng global (không tenant) → xoá tường minh theo email.
      await admin.query(`DELETE FROM platform_users WHERE email = $1`, [platformEmail]);
      await admin.end();
    }
    await app?.close();
  });

  it('GET /public/plans: không cần token, trả đủ 4 gói kèm trần theo cơ sở', async () => {
    const res = await request(http).get('/api/v1/public/plans').expect(200);
    const plans = res.body.data as { code: string; max_rooms_per_property: number }[];
    expect(plans.map((p) => p.code).sort()).toEqual(['ENTERPRISE', 'FREE', 'PRO', 'STARTER']);
    expect(plans.find((p) => p.code === 'STARTER')?.max_rooms_per_property).toBe(15);
    expect(res.headers['cache-control']).toContain('max-age=300');
  });

  it('plan-limit property: trial ở gói STARTER (max 1) → property thứ 2 → 422 PLAN_LIMIT_REACHED', async () => {
    propertyId = (await createProperty('P1').expect(201)).body.data.id;
    const res = await createProperty('P2').expect(422);
    expect(res.body.error.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('plan-limit room: STARTER trần 15 phòng/cơ sở → phòng thứ 16 → 422', async () => {
    await seedRooms(propertyId, 14, 'S'); // 14 nhồi thẳng DB…
    await createRoom('101').expect(201); // …+1 qua API = 15, chạm trần
    const res = await createRoom('102').expect(422);
    expect(res.body.error.code).toBe('PLAN_LIMIT_REACHED');
    expect(res.body.error.detail).toContain('mỗi cơ sở');
  });

  it('GET /billing/subscription: gói STARTER + status TRIAL + usage kèm chi tiết từng cơ sở', async () => {
    const res = await request(http).get('/api/v1/billing/subscription').set(auth()).expect(200);
    const d = res.body.data;
    expect(d.status).toBe('TRIAL');
    expect(d.plan.code).toBe('STARTER');
    expect(d.plan.max_properties).toBe(1);
    expect(d.plan.max_rooms_per_property).toBe(15);
    expect(d.usage.properties).toBe(1);
    expect(d.usage.rooms).toBe(15);
    expect(d.usage.users).toBe(1);
    expect(d.usage.rooms_by_property).toEqual([
      { property_id: propertyId, property_name: 'P1', rooms: 15 },
    ]);
    expect(d.trial_ends_at).toBeTruthy();
  });

  it('PlanFeatureGuard: gói FREE gọi /channels → 402 PLAN_FEATURE_REQUIRED', async () => {
    await setPlan('FREE');
    const res = await request(http)
      .get('/api/v1/channels')
      .query({ property_id: propertyId })
      .set(auth())
      .expect(402);
    expect(res.body.error.code).toBe('PLAN_FEATURE_REQUIRED');
    await setPlan('STARTER'); // trả lại trạng thái trial để test sau chạy đúng
  });

  it('charge: gói FREE (giá 0) → 422; gói PRO → VietQR động + payment PENDING', async () => {
    await request(http)
      .post('/api/v1/billing/charge')
      .set(auth())
      .send({ plan_code: 'FREE' })
      .expect(422);

    const res = await request(http)
      .post('/api/v1/billing/charge')
      .set(auth())
      .send({ plan_code: 'PRO' })
      .expect(200);
    const d = res.body.data;
    expect(d.payment.status).toBe('PENDING');
    expect(d.payment.amount_vnd).toBe(799_000);
    expect(d.payment.payment_ref).toMatch(/^SUB-/);
    expect(d.qr.payload).toMatch(/^000201/); // EMVCo payload indicator
    expect(d.qr.amount_vnd).toBe(799_000);
    proPaymentId = d.payment.id;
  });

  it('GET /billing/payments: chứa payment PENDING vừa tạo', async () => {
    const res = await request(http).get('/api/v1/billing/payments').set(auth()).expect(200);
    const found = (res.body.data as { id: string; status: string }[]).find((p) => p.id === proPaymentId);
    expect(found?.status).toBe('PENDING');
  });

  it('platform confirm: không token → 401; token platform → ACTIVE + plan PRO + nâng giới hạn', async () => {
    await request(http).post(`/api/v1/platform/subscription-payments/${proPaymentId}/confirm`).expect(401);

    const ok = await request(http)
      .post(`/api/v1/platform/subscription-payments/${proPaymentId}/confirm`)
      .set(platformAuth())
      .expect(200);
    expect(ok.body.data.status).toBe('CONFIRMED');

    const sub = (await request(http).get('/api/v1/billing/subscription').set(auth()).expect(200)).body.data;
    expect(sub.status).toBe('ACTIVE');
    expect(sub.plan.code).toBe('PRO');
    expect(sub.current_period_end).toBeTruthy();

    // PRO cho 3 cơ sở → property thứ 2 giờ tạo được.
    secondPropertyId = (await createProperty('P2-after-upgrade').expect(201)).body.data.id;
    // …và tính năng của gói mở NGAY (confirmPayment invalidate cache feature).
    await request(http).get('/api/v1/channels').query({ property_id: propertyId }).set(auth()).expect(200);
  });

  it('trần theo TỪNG cơ sở: P1 đầy 25 phòng → chặn ở P1 nhưng P2 vẫn thêm được', async () => {
    // PRO: 25 phòng/cơ sở, 75 tổng. P1 đang có 15 → nhồi thêm 10 là chạm trần cơ sở.
    await seedRooms(propertyId, 10, 'F');
    const blocked = await createRoom('999', propertyId).expect(422);
    expect(blocked.body.error.detail).toContain('mỗi cơ sở');
    // Trần tổng (75) còn dư → cơ sở khác không bị vạ lây.
    await createRoom('201', secondPropertyId).expect(201);
  });

  it('lifecycle: TRIAL hết hạn → hạ về FREE + ACTIVE, dữ liệu giữ nguyên, không bị treo', async () => {
    await request(http)
      .post('/api/v1/auth/register')
      .send({
        tenant_slug: trialSlug,
        tenant_display_name: 'BILLING TRIAL E2E',
        email: trialEmail,
        password: PASSWORD,
        full_name: 'Trial Owner',
      })
      .expect(201);
    const trialTenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [trialSlug]))
      .rows[0].id;
    const trialToken = (
      await request(http)
        .post('/api/v1/auth/login')
        .set('X-Tenant-Slug', trialSlug)
        .send({ email: trialEmail, password: PASSWORD })
        .expect(200)
    ).body.data.access_token;
    const trialAuth = { Authorization: `Bearer ${trialToken}` };

    // Dùng thử ở hạn mức STARTER → tạo được 8 phòng, vượt xa trần FREE (5).
    const trialProperty = (
      await request(http)
        .post('/api/v1/properties')
        .set(trialAuth)
        .send({ name: 'TP1', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' })
        .expect(201)
    ).body.data.id;
    await admin.query(
      `INSERT INTO rooms (tenant_id, property_id, room_number)
       SELECT $1, $2, 'T' || g FROM generate_series(1, 8) g`,
      [trialTenantId, trialProperty],
    );

    await admin.query(`UPDATE tenants SET trial_ends_at = now() - interval '1 day' WHERE id = $1`, [
      trialTenantId,
    ]);
    const swept = await subscription().runLifecycleSweep(new Date());
    expect(swept.downgraded).toBeGreaterThanOrEqual(1);

    const row = (
      await admin.query(
        `SELECT t.status, p.code, t.trial_ends_at, t.current_period_end
         FROM tenants t JOIN subscription_plans p ON p.id = t.subscription_plan_id
         WHERE t.id = $1`,
        [trialTenantId],
      )
    ).rows[0];
    expect(row.status).toBe('ACTIVE'); // hạ gói, KHÔNG khoá
    expect(row.code).toBe('FREE');
    expect(row.trial_ends_at).toBeNull();
    expect(row.current_period_end).toBeNull();

    await tenantStatus().invalidate(trialTenantId);
    await app.get(PlanFeatureService).invalidate(trialTenantId);

    // Dữ liệu cũ còn nguyên dù vượt trần FREE…
    const rooms = await request(http)
      .get('/api/v1/rooms')
      .query({ property_id: trialProperty })
      .set(trialAuth)
      .expect(200);
    expect(rooms.body.data).toHaveLength(8);
    // …chỉ chặn TẠO MỚI.
    await request(http)
      .post('/api/v1/rooms')
      .set(trialAuth)
      .send({ property_id: trialProperty, room_number: 'T99' })
      .expect(422);

    // Vòng cron kế tiếp KHÔNG được treo tenant vừa hạ (current_period_end NULL).
    await subscription().runLifecycleSweep(new Date());
    const after = (await admin.query(`SELECT status FROM tenants WHERE id = $1`, [trialTenantId]))
      .rows[0].status;
    expect(after).toBe('ACTIVE');
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
      .send({ plan_code: 'PRO' })
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
