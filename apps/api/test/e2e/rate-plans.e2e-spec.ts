import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance task 2.2: CRUD rate plans + rules + gán resource; 1 default per
 * (property, mode); sửa giá → bump version; effective_from < effective_to;
 * TỪ CHỐI 2 rule cùng priority chồng ngày (docs/07 §8).
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `rp-${RUN}`;

describe('Rate Plans + Rules + vietnam_holidays (task 2.2)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let propertyId: string;
  let resourceId: string;
  let plan1: string;
  let plan2: string;

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
        tenant_display_name: 'RP E2E',
        email: `owner-${RUN}@e2e.test`,
        password: PASSWORD,
        full_name: 'Owner',
      })
      .expect(201);
    // Test này cần 2 property (fixture "gán resource khác property") — nâng gói
    // ENTERPRISE để qua plan-limit guard (task 4.7; gói FREE mặc định chỉ 1 property).
    await admin.query(
      `UPDATE tenants SET subscription_plan_id = (SELECT id FROM subscription_plans WHERE code = 'ENTERPRISE')
       WHERE slug = $1`,
      [tenantSlug],
    );
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
    const room = await request(http)
      .post('/api/v1/rooms')
      .set(auth())
      .send({ property_id: propertyId, room_number: '101' })
      .expect(201);
    // resource ROOM tự sinh khi tạo phòng
    const resources = await request(http)
      .get(`/api/v1/bookable-resources?property_id=${propertyId}`)
      .set(auth())
      .expect(200);
    resourceId = resources.body.data[0].id;
    expect(room.body.data.id).toBeDefined();
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM rate_plans WHERE tenant_id IN ${tid}`); // cascade rules + resources
      await admin.query(`DELETE FROM room_occupancy WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM resource_members WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM bookable_resources WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM rooms WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await app?.close();
  });

  it('plan đầu tiên của (property, mode) → tự động là default', async () => {
    const res = await request(http)
      .post('/api/v1/rate-plans')
      .set(auth())
      .send({
        property_id: propertyId,
        name: 'Giá cơ bản DAILY',
        mode: 'DAILY',
        base_price_vnd: 500_000,
        deposit_type: 'PERCENT',
        deposit_value: 3000,
        effective_from: '2026-01-01',
        resource_ids: [resourceId],
      })
      .expect(201);
    plan1 = res.body.data.id;
    expect(res.body.data.is_default).toBe(true);
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.base_price_vnd).toBe(500_000);
    expect(res.body.data.deposit_value).toBe(3000);
    expect(res.body.data.resource_ids).toContain(resourceId);
  });

  it('plan thứ 2 cùng mode → KHÔNG default; set default chuyển quyền', async () => {
    const res = await request(http)
      .post('/api/v1/rate-plans')
      .set(auth())
      .send({ property_id: propertyId, name: 'Giá cao điểm', mode: 'DAILY', base_price_vnd: 800_000, effective_from: '2026-06-01' })
      .expect(201);
    plan2 = res.body.data.id;
    expect(res.body.data.is_default).toBe(false);

    // Đặt plan2 làm default → plan1 mất default (uq_rate_plan_default đảm bảo ≤1)
    await request(http)
      .patch(`/api/v1/rate-plans/${plan2}`)
      .set(auth())
      .send({ is_default: true })
      .expect(200);
    const p1 = await request(http).get(`/api/v1/rate-plans/${plan1}`).set(auth()).expect(200);
    expect(p1.body.data.is_default).toBe(false);
  });

  it('bỏ default trên gói đang là default → 422', async () => {
    const res = await request(http)
      .patch(`/api/v1/rate-plans/${plan2}`)
      .set(auth())
      .send({ is_default: false });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('RATE_PLAN_DEFAULT_REQUIRED');
  });

  it('sửa giá → bump version', async () => {
    const before = (await request(http).get(`/api/v1/rate-plans/${plan1}`).set(auth())).body.data.version;
    const res = await request(http)
      .patch(`/api/v1/rate-plans/${plan1}`)
      .set(auth())
      .send({ base_price_vnd: 550_000 })
      .expect(200);
    expect(res.body.data.version).toBe(before + 1);
    expect(res.body.data.base_price_vnd).toBe(550_000);

    // đổi field không phải giá (name) → KHÔNG bump
    const res2 = await request(http)
      .patch(`/api/v1/rate-plans/${plan1}`)
      .set(auth())
      .send({ name: 'Giá cơ bản 2026' })
      .expect(200);
    expect(res2.body.data.version).toBe(before + 1);
  });

  it('effective_to <= effective_from → 400 (create)', async () => {
    await request(http)
      .post('/api/v1/rate-plans')
      .set(auth())
      .send({
        property_id: propertyId,
        name: 'Sai ngày',
        mode: 'HOURLY',
        base_price_vnd: 100_000,
        effective_from: '2026-05-01',
        effective_to: '2026-04-01',
      })
      .expect(400);
  });

  it('gán resource khác property → 422', async () => {
    const otherProp = (
      await request(http)
        .post('/api/v1/properties')
        .set(auth())
        .send({ name: 'P2', property_type: 'HOMESTAY', address_line: 'b', province: 'Hà Nội' })
        .expect(201)
    ).body.data.id;
    const otherRoom = await request(http)
      .post('/api/v1/rooms')
      .set(auth())
      .send({ property_id: otherProp, room_number: 'X' })
      .expect(201);
    const otherRes = (
      await request(http).get(`/api/v1/bookable-resources?property_id=${otherProp}`).set(auth())
    ).body.data[0].id;
    void otherRoom;

    const res = await request(http)
      .put(`/api/v1/rate-plans/${plan1}/resources`)
      .set(auth())
      .send({ resource_ids: [otherRes] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('RATE_PLAN_RESOURCES_INVALID');
  });

  it('rule: tạo OK + 2 rule cùng priority chồng ngày → 422', async () => {
    const weekend = await request(http)
      .post(`/api/v1/rate-plans/${plan1}/rules`)
      .set(auth())
      .send({
        rule_type: 'WEEKEND',
        days_of_week: [0, 6],
        price_modifier_type: 'PERCENT',
        price_modifier_value: 2000,
        priority: 10,
      })
      .expect(201);
    expect(weekend.body.data.priority).toBe(10);

    // cùng priority 10, ngày chồng (thứ 7) → từ chối
    const conflict = await request(http)
      .post(`/api/v1/rate-plans/${plan1}/rules`)
      .set(auth())
      .send({
        rule_type: 'WEEKEND',
        days_of_week: [6],
        price_modifier_type: 'FIXED',
        price_modifier_value: 100_000,
        priority: 10,
      });
    expect(conflict.status).toBe(422);
    expect(conflict.body.error.code).toBe('RATE_PLAN_RULE_PRIORITY_OVERLAP');

    // cùng priority nhưng ngày RỜI nhau (thứ 2) → OK
    await request(http)
      .post(`/api/v1/rate-plans/${plan1}/rules`)
      .set(auth())
      .send({
        rule_type: 'WEEKDAY',
        days_of_week: [1],
        price_modifier_type: 'PERCENT',
        price_modifier_value: -1000,
        priority: 10,
      })
      .expect(201);

    // OVERRIDE ngày lễ priority cao hơn → OK (priority khác)
    await request(http)
      .post(`/api/v1/rate-plans/${plan1}/rules`)
      .set(auth())
      .send({
        rule_type: 'HOLIDAY',
        price_modifier_type: 'OVERRIDE',
        price_modifier_value: 1_200_000,
        priority: 100,
      })
      .expect(201);

    const list = await request(http).get(`/api/v1/rate-plans/${plan1}/rules`).set(auth()).expect(200);
    expect(list.body.data).toHaveLength(3);
    expect(list.body.data[0].priority).toBe(100); // sort priority desc
  });

  it('getById trả kèm rules + resource_ids', async () => {
    const res = await request(http).get(`/api/v1/rate-plans/${plan1}`).set(auth()).expect(200);
    expect(res.body.data.rules.length).toBe(3);
    expect(res.body.data.resource_ids).toContain(resourceId);
  });

  it('xoá gói default khi còn gói khác → 422; list theo mode', async () => {
    const del = await request(http).delete(`/api/v1/rate-plans/${plan2}`).set(auth());
    expect(del.status).toBe(422);
    expect(del.body.error.code).toBe('RATE_PLAN_DEFAULT_REQUIRED');

    const list = await request(http)
      .get(`/api/v1/rate-plans?property_id=${propertyId}&mode=DAILY`)
      .set(auth())
      .expect(200);
    expect(list.body.data.every((p: { mode: string }) => p.mode === 'DAILY')).toBe(true);
    expect(list.body.data.length).toBeGreaterThanOrEqual(2);
  });
});
