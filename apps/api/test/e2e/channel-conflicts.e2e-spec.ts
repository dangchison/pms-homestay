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
 * GET /channels/conflict-count — tổng xung đột OTA gần đây (7 ngày) theo cơ sở,
 * cộng `sync_jobs.conflict_count` (Dashboard alert "Xung đột OTA"). RBAC
 * channel.manage; STAFF → 403. Job cũ ngoài cửa sổ 7 ngày KHÔNG được đếm.
 */
const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `conf-${RUN}`;
const ownerEmail = `owner-${RUN}@e2e.test`;
const staffEmail = `staff-${RUN}@e2e.test`;

describe('Channels conflict-count (Dashboard OTA alert)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let staffToken: string;
  let tenantId: string;
  let propA: string;
  let propB: string;
  let channelId: string;

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
        tenant_display_name: 'CONFLICT E2E',
        email: ownerEmail,
        password: PASSWORD,
        full_name: 'Owner',
      })
      .expect(201);
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id;
    await admin.query(
      `UPDATE tenants SET subscription_plan_id = (SELECT id FROM subscription_plans WHERE code = 'ENTERPRISE')
       WHERE id = $1`,
      [tenantId],
    );
    token = (
      await request(http)
        .post('/api/v1/auth/login')
        .set('X-Tenant-Slug', tenantSlug)
        .send({ email: ownerEmail, password: PASSWORD })
        .expect(200)
    ).body.data.access_token;

    const createProperty = async (name: string): Promise<string> =>
      (
        await request(http)
          .post('/api/v1/properties')
          .set(auth())
          .send({ name, property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' })
          .expect(201)
      ).body.data.id;
    propA = await createProperty('Prop A');
    propB = await createProperty('Prop B');

    channelId = (
      await request(http)
        .post('/api/v1/channels')
        .set(auth())
        .send({ property_id: propA, channel_type: 'AIRBNB_ICAL', display_name: 'Airbnb' })
        .expect(201)
    ).body.data.id;

    // sync_jobs: 2 job gần đây (conflict 2 + 1 = 3) + 1 job cũ ngoài 7 ngày (5, KHÔNG đếm).
    await admin.query(
      `INSERT INTO sync_jobs (tenant_id, channel_id, job_type, status, finished_at, conflict_count) VALUES
         ($1, $2, 'PULL', 'PARTIAL', now() - interval '1 day', 2),
         ($1, $2, 'PULL', 'PARTIAL', now() - interval '2 days', 1),
         ($1, $2, 'PULL', 'PARTIAL', now() - interval '30 days', 5)`,
      [tenantId, channelId],
    );

    const staffHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const staff = await admin.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, default_role)
       VALUES ($1, $2, $3, 'Staff', 'STAFF') RETURNING id`,
      [tenantId, staffEmail, staffHash],
    );
    await admin.query(
      `INSERT INTO user_property_roles (tenant_id, user_id, property_id, role) VALUES ($1, $2, $3, 'STAFF')`,
      [tenantId, staff.rows[0].id, propA],
    );
    staffToken = (
      await request(http)
        .post('/api/v1/auth/login')
        .set('X-Tenant-Slug', tenantSlug)
        .send({ email: staffEmail, password: PASSWORD })
        .expect(200)
    ).body.data.access_token;
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM sync_jobs WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM channels WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await app?.close();
  });

  it('cộng conflict_count trong 7 ngày (job cũ bị loại)', async () => {
    const res = await request(http)
      .get(`/api/v1/channels/conflict-count?property_id=${propA}`)
      .set(auth())
      .expect(200);
    expect(res.body.data.conflict_count).toBe(3);
  });

  it('cơ sở không có kênh → 0', async () => {
    const res = await request(http)
      .get(`/api/v1/channels/conflict-count?property_id=${propB}`)
      .set(auth())
      .expect(200);
    expect(res.body.data.conflict_count).toBe(0);
  });

  it('STAFF không có channel.manage → 403', async () => {
    await request(http)
      .get(`/api/v1/channels/conflict-count?property_id=${propA}`)
      .set({ Authorization: `Bearer ${staffToken}` })
      .expect(403);
  });
});
