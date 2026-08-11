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

/**
 * ★ Bảng điều khiển nền tảng (web-platform): cấu hình gói, xem/sửa tenant, danh
 * sách thanh toán thuê bao. Tất cả nằm sau PlatformAuthGuard — token tenant KHÔNG
 * dùng được, thiếu token là 401.
 *
 * Kiểm chứng quan trọng nhất: sửa hạn mức/tính năng ở web-platform có hiệu lực
 * NGAY với tenant đang chạy (không đợi TTL cache, không restart API).
 *
 * ⚠️ `subscription_plans` là master data DÙNG CHUNG giữa các spec chạy song song.
 * Spec này chỉ được phép sửa gói ENTERPRISE — gói duy nhất không spec nào khác
 * dựa vào (giá 0 nên không charge được, seed cũng không gán cho tenant mới). Sửa
 * STARTER/PRO ở đây sẽ làm billing-lite đỏ ngẫu nhiên.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `platadm-${RUN}`;
const ownerEmail = `owner-${RUN}@e2e.test`;
const platformEmail = `padmin-${RUN}@platform.test`;
/** Gói dành riêng cho spec này thao tác — xem cảnh báo ở trên. */
const SANDBOX_PLAN = 'ENTERPRISE';

interface PlanSnapshot {
  id: string;
  max_rooms: number;
  max_rooms_per_property: number;
  features: Record<string, boolean>;
}

describe('Platform admin console', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let platformToken: string;
  let tenantId: string;
  let propertyId: string;
  let sandbox: PlanSnapshot;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const platformAuth = () => ({ Authorization: `Bearer ${platformToken}` });
  const patchPlan = (body: unknown) =>
    request(http).patch(`/api/v1/platform/plans/${sandbox.id}`).set(platformAuth()).send(body);
  const createRoom = (num: string) =>
    request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: num });

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
        tenant_display_name: 'PLATFORM ADMIN E2E',
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

    const phash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    await admin.query(
      `INSERT INTO platform_users (email, password_hash, full_name, is_active) VALUES ($1,$2,'Platform Admin',true)`,
      [platformEmail, phash],
    );
    platformToken = (
      await request(http)
        .post('/api/v1/platform/auth/login')
        .send({ email: platformEmail, password: PASSWORD })
        .expect(200)
    ).body.data.access_token;

    const row = (
      await admin.query(
        `SELECT id, max_rooms, max_rooms_per_property, features FROM subscription_plans WHERE code = $1`,
        [SANDBOX_PLAN],
      )
    ).rows[0];
    sandbox = {
      id: row.id,
      max_rooms: row.max_rooms,
      max_rooms_per_property: row.max_rooms_per_property,
      features: row.features ?? {},
    };

    propertyId = (
      await request(http)
        .post('/api/v1/properties')
        .set(auth())
        .send({ name: 'P1', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' })
        .expect(201)
    ).body.data.id;
    for (const n of ['101', '102', '103']) await createRoom(n).expect(201);
  });

  afterAll(async () => {
    if (admin) {
      // Trả gói sandbox nguyên trạng kể cả khi spec vỡ giữa chừng — nếu không, lần
      // chạy sau đọc phải cấu hình rò từ lần này.
      await admin.query(
        `UPDATE subscription_plans
            SET max_rooms = $2, max_rooms_per_property = $3, features = $4::jsonb
          WHERE id = $1`,
        [sandbox.id, sandbox.max_rooms, sandbox.max_rooms_per_property, JSON.stringify(sandbox.features)],
      );

      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM resource_members WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM bookable_resources WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM rooms WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM guests WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM platform_users WHERE email = $1`, [platformEmail]);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await app?.close();
  });

  it('không token → 401; token TENANT cũng → 401 (secret khác + typ khác)', async () => {
    await request(http).get('/api/v1/platform/plans').expect(401);
    const res = await request(http).get('/api/v1/platform/plans').set(auth()).expect(401);
    expect(res.body.error.code).toBe('PLATFORM_TOKEN_INVALID');
  });

  it('GET /platform/plans: 4 gói theo bậc thang, kèm số tenant đang dùng', async () => {
    const res = await request(http).get('/api/v1/platform/plans').set(platformAuth()).expect(200);
    const plans = res.body.data as { code: string; tenant_count: number }[];
    // Thứ tự bậc thang, KHÔNG theo giá — ENTERPRISE giá 0 (= liên hệ) phải đứng cuối.
    expect(plans.map((p) => p.code)).toEqual(['FREE', 'STARTER', 'PRO', 'ENTERPRISE']);
    expect(plans.find((p) => p.code === 'STARTER')!.tenant_count).toBeGreaterThanOrEqual(1);
  });

  it('POST /platform/plans: trùng mã → 409', async () => {
    const res = await request(http)
      .post('/api/v1/platform/plans')
      .set(platformAuth())
      .send({
        code: 'STARTER',
        name: 'TRÙNG',
        max_properties: 1,
        max_rooms: 10,
        max_rooms_per_property: 10,
        max_users: 2,
        monthly_price_vnd: 1000,
        features: {},
      })
      .expect(409);
    expect(res.body.error.code).toBe('SUBSCRIPTION_PLAN_EXISTS');
  });

  it('GET /platform/tenants: tìm theo slug, kèm gói (danh sách KHÔNG có usage)', async () => {
    const res = await request(http)
      .get('/api/v1/platform/tenants')
      .query({ q: tenantSlug })
      .set(platformAuth())
      .expect(200);
    expect(res.body.data.total).toBe(1);
    const t = res.body.data.items[0];
    expect(t.slug).toBe(tenantSlug);
    expect(t.status).toBe('TRIAL');
    expect(t.plan_code).toBe('STARTER'); // đăng ký = trial ở mức STARTER
    expect(t.usage).toBeUndefined();
  });

  it('GET /platform/tenants/:id: usage thật, đếm được qua RLS', async () => {
    const res = await request(http)
      .get(`/api/v1/platform/tenants/${tenantId}`)
      .set(platformAuth())
      .expect(200);
    const d = res.body.data;
    expect(d.slug).toBe(tenantSlug);
    expect(d.usage.properties).toBe(1);
    expect(d.usage.rooms).toBe(3);
    expect(d.usage.users).toBe(1);
    expect(d.usage.rooms_by_property).toEqual([
      { property_id: propertyId, property_name: 'P1', rooms: 3 },
    ]);
  });

  it(`PATCH /platform/tenants/:id: đổi sang gói ${SANDBOX_PLAN}`, async () => {
    const up = await request(http)
      .patch(`/api/v1/platform/tenants/${tenantId}`)
      .set(platformAuth())
      .send({ plan_code: SANDBOX_PLAN })
      .expect(200);
    expect(up.body.data.plan_code).toBe(SANDBOX_PLAN);
  });

  it('PATCH /platform/plans/:id: trần cơ sở > trần tổng → 422 PLAN_LIMITS_INCOHERENT', async () => {
    const res = await patchPlan({ max_rooms: 10, max_rooms_per_property: 99 }).expect(422);
    expect(res.body.error.code).toBe('PLAN_LIMITS_INCOHERENT');
  });

  it('★ hạ trần ở web-platform → tenant đang chạy bị chặn NGAY (không đợi cache)', async () => {
    await patchPlan({ max_rooms_per_property: 3 }).expect(200);

    const blocked = await createRoom('104').expect(422);
    expect(blocked.body.error.code).toBe('PLAN_LIMIT_REACHED');
    expect(blocked.body.error.detail).toContain('mỗi cơ sở');

    // Nới lại → tạo được ngay, cũng không cần restart.
    await patchPlan({ max_rooms_per_property: sandbox.max_rooms_per_property }).expect(200);
    await createRoom('104').expect(201);
  });

  it('★ bật tính năng trong gói → endpoint 402 mở ra ngay', async () => {
    const assets = () =>
      request(http).get('/api/v1/assets').query({ property_id: propertyId }).set(auth());

    await patchPlan({ features: { cleaning: true } }).expect(200);
    const before = await assets().expect(402);
    expect(before.body.error.code).toBe('PLAN_FEATURE_REQUIRED');

    await patchPlan({ features: { cleaning: true, assets: true } }).expect(200);
    await assets().expect(200);

    await patchPlan({ features: sandbox.features }).expect(200);
  });

  it('PATCH /platform/tenants/:id: tạm ngưng → chặn write ngay; kích hoạt → mở lại', async () => {
    await request(http)
      .patch(`/api/v1/platform/tenants/${tenantId}`)
      .set(platformAuth())
      .send({ status: 'SUSPENDED' })
      .expect(200);
    const blocked = await request(http)
      .post('/api/v1/guests')
      .set(auth())
      .send({ full_name: 'Khách A' })
      .expect(403);
    expect(blocked.body.error.code).toBe('TENANT_SUSPENDED');

    await request(http)
      .patch(`/api/v1/platform/tenants/${tenantId}`)
      .set(platformAuth())
      .send({ status: 'ACTIVE' })
      .expect(200);
    await request(http).post('/api/v1/guests').set(auth()).send({ full_name: 'Khách B' }).expect(201);
  });

  it('GET /platform/subscription-payments: lọc PENDING, kèm tên tenant', async () => {
    // ENTERPRISE giá 0 = "liên hệ", không charge được → dùng PRO để tạo payment.
    const charge = await request(http)
      .post('/api/v1/billing/charge')
      .set(auth())
      .send({ plan_code: 'PRO' })
      .expect(200);
    const paymentId = charge.body.data.payment.id;

    const res = await request(http)
      .get('/api/v1/platform/subscription-payments')
      .query({ status: 'PENDING' })
      .set(platformAuth())
      .expect(200);
    const found = (res.body.data as { id: string; tenant_slug: string }[]).find(
      (p) => p.id === paymentId,
    );
    expect(found?.tenant_slug).toBe(tenantSlug);
  });
});
