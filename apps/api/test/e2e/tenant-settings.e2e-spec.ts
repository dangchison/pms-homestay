import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { generateSync } from 'otplib';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance task 6.7 S1/S3/S4: hồ sơ tenant (GET/PATCH /tenant — OWNER), danh
 * sách gói (GET /billing/plans), đổi mật khẩu (POST /auth/change-password), bật→tắt
 * 2FA (/auth/2fa/*). Non-owner không PATCH được tenant (403).
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const NEW_PASSWORD = 'N3w!Passw0rd-xyz';
const tenantSlug = `tnt-${RUN}`;
const ownerEmail = `owner-${RUN}@e2e.test`;
const staffEmail = `staff-${RUN}@e2e.test`;

describe('Tenant settings — /tenant + /billing/plans + auth (task 6.7 S1/S3/S4)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let staffToken: string;
  let tenantId: string;

  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const login = (email: string, password: string, totp?: string) =>
    request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email, password, ...(totp ? { totp_code: totp } : {}) });

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
      .send({ tenant_slug: tenantSlug, tenant_display_name: 'TNT E2E', email: ownerEmail, password: PASSWORD, full_name: 'Owner' })
      .expect(201);
    token = (await login(ownerEmail, PASSWORD).expect(200)).body.data.access_token;
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id;

    const propertyId = (
      await request(http).post('/api/v1/properties').set(auth()).send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' }).expect(201)
    ).body.data.id;
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const staff = await admin.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, default_role) VALUES ($1,$2,$3,'NV','STAFF') RETURNING id`,
      [tenantId, staffEmail, hash],
    );
    await admin.query(`INSERT INTO user_property_roles (tenant_id, user_id, property_id, role) VALUES ($1,$2,$3,'STAFF')`, [tenantId, staff.rows[0].id, propertyId]);
    staffToken = (await login(staffEmail, PASSWORD).expect(200)).body.data.access_token;
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await app?.close();
  });

  it('GET /tenant trả hồ sơ tenant', async () => {
    const res = await request(http).get('/api/v1/tenant').set(auth()).expect(200);
    expect(res.body.data.slug).toBe(tenantSlug);
    expect(res.body.data.display_name).toBe('TNT E2E');
    expect(res.body.data.status).toBeDefined();
  });

  it('PATCH /tenant cập nhật tên + timezone (OWNER)', async () => {
    const res = await request(http).patch('/api/v1/tenant').set(auth()).send({ display_name: 'Homestay Đổi Tên', timezone: 'Asia/Bangkok' }).expect(200);
    expect(res.body.data.display_name).toBe('Homestay Đổi Tên');
    expect(res.body.data.timezone).toBe('Asia/Bangkok');
  });

  it('STAFF không PATCH được /tenant → 403; nhưng GET được (tenant.read)', async () => {
    await request(http).patch('/api/v1/tenant').set(auth(staffToken)).send({ display_name: 'Hack' }).expect(403);
    await request(http).get('/api/v1/tenant').set(auth(staffToken)).expect(200);
  });

  it('GET /billing/plans liệt kê các gói', async () => {
    const res = await request(http).get('/api/v1/billing/plans').set(auth()).expect(200);
    const codes = (res.body.data as { code: string }[]).map((p) => p.code);
    expect(codes).toContain('FREE');
    expect(codes.length).toBeGreaterThanOrEqual(2);
  });

  it('2FA: enable → verify → disable', async () => {
    const enable = await request(http).post('/api/v1/auth/2fa/enable').set(auth()).expect(200);
    const secret = enable.body.data.secret as string;
    await request(http).post('/api/v1/auth/2fa/verify').set(auth()).send({ totp_code: generateSync({ secret }) }).expect(204);
    // Đã bật → login cần mã
    expect((await login(ownerEmail, PASSWORD)).status).toBe(401);
    // Tắt bằng TOTP hợp lệ
    await request(http).post('/api/v1/auth/2fa/disable').set(auth()).send({ totp_code: generateSync({ secret }) }).expect(204);
    // Tắt rồi → login chỉ cần mật khẩu
    await login(ownerEmail, PASSWORD).expect(200);
  });

  it('2FA disable khi chưa bật → 400', async () => {
    const res = await request(http).post('/api/v1/auth/2fa/disable').set(auth(staffToken)).send({ totp_code: '000000' }).expect(400);
    expect(res.body.error.code).toBe('AUTH_2FA_NOT_ENABLED');
  });

  it('đổi mật khẩu: sai mật khẩu hiện tại → 400; đúng → 204 + login bằng mật khẩu mới', async () => {
    await request(http).post('/api/v1/auth/change-password').set(auth()).send({ current_password: 'wrong-password', new_password: NEW_PASSWORD }).expect(400);
    await request(http).post('/api/v1/auth/change-password').set(auth()).send({ current_password: PASSWORD, new_password: NEW_PASSWORD }).expect(204);
    await login(ownerEmail, NEW_PASSWORD).expect(200);
    expect((await login(ownerEmail, PASSWORD)).status).toBe(401);
  });
});
