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
 * ★ Acceptance task 6.5 (R3): GET /reports/occupancy đọc rollup daily_property_stats
 * theo ngày → occupancy_rate_pct + ADR/RevPAR. Seed stats qua admin SQL (night-audit
 * fill ở prod). Validate to≥from; property scope.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `rep-${RUN}`;

describe('Occupancy report — GET /reports/occupancy (task 6.5)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let propertyId: string;

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
        tenant_display_name: 'REP E2E',
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

    propertyId = (
      await request(http)
        .post('/api/v1/properties')
        .set(auth())
        .send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' })
        .expect(201)
    ).body.data.id;

    // Seed rollup 2 ngày (night-audit fill ở prod)
    const ins = `INSERT INTO daily_property_stats
      (tenant_id, property_id, stat_date, available_room_nights, occupied_room_nights, room_revenue_vnd, other_revenue_vnd, adr_vnd, revpar_vnd)
      VALUES ((SELECT id FROM tenants WHERE slug=$1), $2, $3, $4, $5, $6, 0, $7, $8)`;
    await admin.query(ins, [tenantSlug, propertyId, '2026-08-01', 10, 7, 3_500_000, 500_000, 350_000]);
    await admin.query(ins, [tenantSlug, propertyId, '2026-08-02', 10, 5, 2_500_000, 500_000, 250_000]);
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM daily_property_stats WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await app?.close();
  });

  it('trả 2 ngày với occupancy_rate_pct + ADR đúng', async () => {
    const res = await request(http)
      .get(`/api/v1/reports/occupancy?property_id=${propertyId}&from=2026-08-01&to=2026-08-31`)
      .set(auth())
      .expect(200);
    const days = res.body.data.days as { stat_date: string; occupancy_rate_pct: number; adr_vnd: number }[];
    expect(days).toHaveLength(2);
    expect(days[0]!.stat_date).toBe('2026-08-01');
    expect(days[0]!.occupancy_rate_pct).toBe(70); // 7/10
    expect(days[0]!.adr_vnd).toBe(500_000);
    expect(days[1]!.occupancy_rate_pct).toBe(50); // 5/10
  });

  it('khoảng không có dữ liệu → days rỗng', async () => {
    const res = await request(http)
      .get(`/api/v1/reports/occupancy?property_id=${propertyId}&from=2026-01-01&to=2026-01-31`)
      .set(auth())
      .expect(200);
    expect(res.body.data.days).toHaveLength(0);
  });

  it('to < from → 400', async () => {
    await request(http)
      .get(`/api/v1/reports/occupancy?property_id=${propertyId}&from=2026-08-31&to=2026-08-01`)
      .set(auth())
      .expect(400);
  });

  it('property không tồn tại → 404', async () => {
    const res = await request(http)
      .get(`/api/v1/reports/occupancy?property_id=${randomUUID()}&from=2026-08-01&to=2026-08-31`)
      .set(auth())
      .expect(404);
    expect(res.body.error.code).toBe('PROPERTY_NOT_FOUND');
  });
});
