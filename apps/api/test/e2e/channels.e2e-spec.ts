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
 * ★ Acceptance task 5.1 (docs/03 §4.8): channels (secret config mã hoá ADR-0007)
 * + channel_resource_mappings (map theo resource) + CRUD + generate/regenerate
 * ical_push_token. RBAC channel.manage (OWNER/MANAGER; STAFF → 403).
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `chan-${RUN}`;
const ownerEmail = `owner-${RUN}@e2e.test`;
const staffEmail = `staff-${RUN}@e2e.test`;
const API_KEY = 'super-secret-channex-key-123';

describe('Channels + resource mappings (task 5.1)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let staffToken: string;
  let tenantId: string;
  let propA: string;
  let propB: string;
  let resourceA: string;
  let resourceB: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const createRoomResource = async (propertyId: string, roomNumber: string): Promise<string> => {
    await request(http)
      .post('/api/v1/rooms')
      .set(auth())
      .send({ property_id: propertyId, room_number: roomNumber })
      .expect(201);
    const res = await request(http)
      .get(`/api/v1/bookable-resources?property_id=${propertyId}`)
      .set(auth())
      .expect(200);
    return (res.body.data as { id: string; type: string }[]).find((r) => r.type === 'ROOM')!.id;
  };

  const createProperty = async (name: string): Promise<string> =>
    (
      await request(http)
        .post('/api/v1/properties')
        .set(auth())
        .send({ name, property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' })
        .expect(201)
    ).body.data.id;

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
        tenant_display_name: 'CHANNEL E2E',
        email: ownerEmail,
        password: PASSWORD,
        full_name: 'Owner',
      })
      .expect(201);
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id;
    // 2 property (ca "resource khác property") → nâng ENTERPRISE qua plan-limit guard (4.7).
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

    propA = await createProperty('Prop A');
    propB = await createProperty('Prop B');
    resourceA = await createRoomResource(propA, '101');
    resourceB = await createRoomResource(propB, '201');

    // STAFF (không có channel.manage) — seed trực tiếp DB.
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
      await admin.query(`DELETE FROM channel_resource_mappings WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM channels WHERE tenant_id IN ${tid}`);
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

  it('CHANNEX_API: tạo kênh + secret api_key mã hoá (DB không lưu plaintext, response mask)', async () => {
    const res = await request(http)
      .post('/api/v1/channels')
      .set(auth())
      .send({
        property_id: propA,
        channel_type: 'CHANNEX_API',
        display_name: 'Channex',
        config: { api_key: API_KEY, region: 'vn' },
      })
      .expect(201);
    const d = res.body.data;
    expect(d.has_secret).toBe(true);
    expect(d.config.api_key).toBeUndefined();
    expect(d.config.api_key_enc).toBeUndefined();
    expect(d.config.region).toBe('vn'); // field thường vẫn giữ

    const row = await admin.query(`SELECT config FROM channels WHERE id = $1`, [d.id]);
    const cfg = row.rows[0].config as Record<string, unknown>;
    expect(cfg.api_key_enc).toBeTruthy();
    expect(cfg.api_key).toBeUndefined();
    expect(JSON.stringify(cfg)).not.toContain(API_KEY); // plaintext KHÔNG xuất hiện
  });

  it('PATCH display_name (không gửi config) → giữ nguyên secret', async () => {
    const id = (
      await request(http)
        .post('/api/v1/channels')
        .set(auth())
        .send({ property_id: propA, channel_type: 'CHANNEX_API', display_name: 'C2', config: { api_key: API_KEY } })
        .expect(201)
    ).body.data.id;
    const upd = await request(http)
      .patch(`/api/v1/channels/${id}`)
      .set(auth())
      .send({ display_name: 'C2-renamed' })
      .expect(200);
    expect(upd.body.data.display_name).toBe('C2-renamed');
    expect(upd.body.data.has_secret).toBe(true); // secret không mất
  });

  it('AIRBNB_ICAL: tạo kênh + mapping → ical_push_token tự sinh (48 hex)', async () => {
    const channelId = (
      await request(http)
        .post('/api/v1/channels')
        .set(auth())
        .send({ property_id: propA, channel_type: 'AIRBNB_ICAL', display_name: 'Airbnb' })
        .expect(201)
    ).body.data;
    expect(channelId.has_secret).toBe(false);

    const m = (
      await request(http)
        .post(`/api/v1/channels/${channelId.id}/mappings`)
        .set(auth())
        .send({
          resource_id: resourceA,
          external_listing_id: 'LISTING-1',
          ical_pull_url: 'https://airbnb.com/calendar/x.ics',
        })
        .expect(201)
    ).body.data;
    expect(m.ical_push_token).toMatch(/^[0-9a-f]{48}$/);
    expect(m.resource_id).toBe(resourceA);
    expect(m.last_event_count).toBe(0);

    const list = await request(http).get(`/api/v1/channels/${channelId.id}/mappings`).set(auth()).expect(200);
    expect(list.body.data).toHaveLength(1);
  });

  it('regenerate-token: đổi token mới khác token cũ', async () => {
    const channelId = (
      await request(http)
        .post('/api/v1/channels')
        .set(auth())
        .send({ property_id: propA, channel_type: 'BOOKING_ICAL', display_name: 'Booking' })
        .expect(201)
    ).body.data.id;
    const m = (
      await request(http)
        .post(`/api/v1/channels/${channelId}/mappings`)
        .set(auth())
        .send({ resource_id: resourceA, external_listing_id: 'BK-1' })
        .expect(201)
    ).body.data;
    const regen = await request(http)
      .post(`/api/v1/channel-mappings/${m.id}/regenerate-token`)
      .set(auth())
      .expect(200);
    expect(regen.body.data.ical_push_token).toMatch(/^[0-9a-f]{48}$/);
    expect(regen.body.data.ical_push_token).not.toBe(m.ical_push_token);
  });

  it('mapping trùng (channel, resource) → 409; resource khác property → 422', async () => {
    const channelId = (
      await request(http)
        .post('/api/v1/channels')
        .set(auth())
        .send({ property_id: propA, channel_type: 'AGODA_ICAL', display_name: 'Agoda' })
        .expect(201)
    ).body.data.id;
    await request(http)
      .post(`/api/v1/channels/${channelId}/mappings`)
      .set(auth())
      .send({ resource_id: resourceA, external_listing_id: 'AG-1' })
      .expect(201);
    // trùng (channel, resource)
    const dup = await request(http)
      .post(`/api/v1/channels/${channelId}/mappings`)
      .set(auth())
      .send({ resource_id: resourceA, external_listing_id: 'AG-2' })
      .expect(409);
    expect(dup.body.error.code).toBe('CHANNEL_MAPPING_DUPLICATE');
    // resource thuộc propB nhưng channel ở propA
    const mismatch = await request(http)
      .post(`/api/v1/channels/${channelId}/mappings`)
      .set(auth())
      .send({ resource_id: resourceB, external_listing_id: 'AG-3' })
      .expect(422);
    expect(mismatch.body.error.code).toBe('RESOURCE_PROPERTY_MISMATCH');
  });

  it('update + delete mapping; delete channel → cascade mapping + 404', async () => {
    const channelId = (
      await request(http)
        .post('/api/v1/channels')
        .set(auth())
        .send({ property_id: propA, channel_type: 'AIRBNB_ICAL', display_name: 'ToDelete' })
        .expect(201)
    ).body.data.id;
    const m = (
      await request(http)
        .post(`/api/v1/channels/${channelId}/mappings`)
        .set(auth())
        .send({ resource_id: resourceA, external_listing_id: 'DEL-1' })
        .expect(201)
    ).body.data;
    await request(http)
      .patch(`/api/v1/channel-mappings/${m.id}`)
      .set(auth())
      .send({ external_listing_id: 'DEL-1-updated', is_active: false })
      .expect(200);

    // xoá channel → cascade mapping con
    await request(http).delete(`/api/v1/channels/${channelId}`).set(auth()).expect(204);
    await request(http).get(`/api/v1/channels/${channelId}`).set(auth()).expect(404);
    const remain = await admin.query(`SELECT count(*)::int AS n FROM channel_resource_mappings WHERE channel_id = $1`, [
      channelId,
    ]);
    expect(remain.rows[0].n).toBe(0);
  });

  it('RBAC: STAFF (không có channel.manage) → POST /channels 403', async () => {
    await request(http)
      .post('/api/v1/channels')
      .set({ Authorization: `Bearer ${staffToken}` })
      .send({ property_id: propA, channel_type: 'AIRBNB_ICAL', display_name: 'X' })
      .expect(403);
  });
});
