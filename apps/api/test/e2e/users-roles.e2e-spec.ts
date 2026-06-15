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
 * ★ Acceptance task 6.7 S2 (ui/01): quản lý users & roles — mời user (email +
 * default role), gán role per-property + override grant/deny, deactivate. Chỉ OWNER
 * (user.invite / user.manage_roles); non-owner 403. Plan-limit wired khi mời.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `users-${RUN}`;
const ownerEmail = `owner-${RUN}@e2e.test`;
const staffEmail = `staff-${RUN}@e2e.test`;
const inviteeEmail = `invitee-${RUN}@e2e.test`;

describe('Users & roles — /users + /user-property-roles (task 6.7 S2)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let staffToken: string;
  let tenantId: string;
  let ownerId: string;
  let propertyId: string;
  let inviteeId: string;

  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

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
      .send({ tenant_slug: tenantSlug, tenant_display_name: 'USERS E2E', email: ownerEmail, password: PASSWORD, full_name: 'Owner' })
      .expect(201);
    const login = await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: ownerEmail, password: PASSWORD }).expect(200);
    token = login.body.data.access_token;
    ownerId = login.body.data.user.id;
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id;
    // Nâng ENTERPRISE để có headroom mời user (FREE max_users nhỏ).
    await admin.query(`UPDATE tenants SET subscription_plan_id = (SELECT id FROM subscription_plans WHERE code = 'ENTERPRISE') WHERE id = $1`, [tenantId]);

    propertyId = (
      await request(http).post('/api/v1/properties').set(auth()).send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' }).expect(201)
    ).body.data.id;

    // STAFF (không có user.manage_roles/user.invite) cho test 403.
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const staff = await admin.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, default_role) VALUES ($1,$2,$3,'NV','STAFF') RETURNING id`,
      [tenantId, staffEmail, hash],
    );
    await admin.query(`INSERT INTO user_property_roles (tenant_id, user_id, property_id, role) VALUES ($1,$2,$3,'STAFF')`, [tenantId, staff.rows[0].id, propertyId]);
    staffToken = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: staffEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;
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

  it('mời user (POST /users) → tạo account + role mặc định', async () => {
    const res = await request(http)
      .post('/api/v1/users')
      .set(auth())
      .send({ email: inviteeEmail, full_name: 'Nhân viên Mới', default_role: 'STAFF' })
      .expect(201);
    expect(res.body.data.email).toBe(inviteeEmail);
    expect(res.body.data.default_role).toBe('STAFF');
    expect(res.body.data.is_active).toBe(true);
    inviteeId = res.body.data.id;
  });

  it('mời trùng email → 409 USER_EMAIL_EXISTS', async () => {
    const res = await request(http)
      .post('/api/v1/users')
      .set(auth())
      .send({ email: inviteeEmail, full_name: 'Trùng', default_role: 'STAFF' })
      .expect(409);
    expect(res.body.error.code).toBe('USER_EMAIL_EXISTS');
  });

  it('GET /users liệt kê owner + staff + invitee', async () => {
    const res = await request(http).get('/api/v1/users').set(auth()).expect(200);
    const emails = (res.body.data as { email: string }[]).map((u) => u.email);
    expect(emails).toEqual(expect.arrayContaining([ownerEmail, staffEmail, inviteeEmail]));
  });

  it('PATCH /users/:id deactivate invitee', async () => {
    const res = await request(http).patch(`/api/v1/users/${inviteeId}`).set(auth()).send({ is_active: false }).expect(200);
    expect(res.body.data.is_active).toBe(false);
  });

  it('không thể tự vô hiệu hoá / đổi role chính mình → 422', async () => {
    await request(http).patch(`/api/v1/users/${ownerId}`).set(auth()).send({ is_active: false }).expect(422);
    const res = await request(http).patch(`/api/v1/users/${ownerId}`).set(auth()).send({ default_role: 'STAFF' }).expect(422);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_SELF');
  });

  it('gán role per-property + override grant/deny → GET /users/:id/property-roles', async () => {
    const res = await request(http)
      .post('/api/v1/user-property-roles')
      .set(auth())
      .send({ user_id: inviteeId, property_id: propertyId, role: 'MANAGER', permissions: { grant: ['report.financial'], deny: ['booking.cancel'] } })
      .expect(201);
    expect(res.body.data.role).toBe('MANAGER');
    expect(res.body.data.permissions.grant).toContain('report.financial');

    const list = await request(http).get(`/api/v1/users/${inviteeId}/property-roles`).set(auth()).expect(200);
    expect((list.body.data as { property_id: string }[]).some((r) => r.property_id === propertyId)).toBe(true);
  });

  it('gán role với permission key sai → 400 INVALID_PERMISSION_KEY', async () => {
    const res = await request(http)
      .post('/api/v1/user-property-roles')
      .set(auth())
      .send({ user_id: inviteeId, property_id: propertyId, role: 'STAFF', permissions: { grant: ['khong.ton.tai'], deny: [] } })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_PERMISSION_KEY');
  });

  it('gán trùng (user+property+role) → 409 ROLE_ASSIGNMENT_DUPLICATE', async () => {
    const res = await request(http)
      .post('/api/v1/user-property-roles')
      .set(auth())
      .send({ user_id: inviteeId, property_id: propertyId, role: 'MANAGER' })
      .expect(409);
    expect(res.body.error.code).toBe('ROLE_ASSIGNMENT_DUPLICATE');
  });

  it('PATCH rồi DELETE property-role', async () => {
    const roles = (await request(http).get(`/api/v1/users/${inviteeId}/property-roles`).set(auth()).expect(200)).body.data as { id: string }[];
    const roleId = roles[0]!.id;
    const patched = await request(http).patch(`/api/v1/user-property-roles/${roleId}`).set(auth()).send({ permissions: { grant: [], deny: [] } }).expect(200);
    expect(patched.body.data.permissions.grant).toEqual([]);
    await request(http).delete(`/api/v1/user-property-roles/${roleId}`).set(auth()).expect(204);
    const after = await request(http).get(`/api/v1/users/${inviteeId}/property-roles`).set(auth()).expect(200);
    expect((after.body.data as unknown[]).length).toBe(0);
  });

  it('STAFF (không user.manage_roles) → 403 trên /users', async () => {
    await request(http).get('/api/v1/users').set(auth(staffToken)).expect(403);
    await request(http).post('/api/v1/users').set(auth(staffToken)).send({ email: `x-${RUN}@e2e.test`, full_name: 'X', default_role: 'STAFF' }).expect(403);
  });
});
