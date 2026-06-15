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
 * Task 8.4 — Bắt buộc 2FA cho vai trò đặc quyền (OWNER/ACCOUNTANT) khi
 * ENFORCE_2FA_FOR_PRIVILEGED_ROLES=true. Set flag TRƯỚC loadEnv() → app instance
 * của file này enforce; afterAll khôi phục để KHÔNG rò sang file test khác (chạy
 * serial cùng process). register KHÔNG bị enforce (owner mới vẫn nhận session đầu
 * để vào enroll 2FA) — chỉ /auth/login chặn.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const FLAG = 'ENFORCE_2FA_FOR_PRIVILEGED_ROLES';

describe('Security: 2FA bắt buộc cho vai trò đặc quyền (task 8.4, flag ON)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let prevFlag: string | undefined;

  const slug = `sec2fa-${RUN}`;
  const ownerEmail = `owner-2fa-${RUN}@e2e.test`;
  const staffEmail = `staff-2fa-${RUN}@e2e.test`;

  beforeAll(async () => {
    prevFlag = process.env[FLAG];
    process.env[FLAG] = 'true'; // bật TRƯỚC loadEnv → app instance này enforce
    const env = loadEnv();
    expect(env.ENFORCE_2FA_FOR_PRIVILEGED_ROLES).toBe(true);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();

    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();

    // register → OWNER (đường register KHÔNG bị enforce).
    await request(http)
      .post('/api/v1/auth/register')
      .send({ tenant_slug: slug, tenant_display_name: 'Sec 2FA', email: ownerEmail, password: PASSWORD, full_name: 'Owner' })
      .expect(201);

    const tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [slug])).rows[0].id;
    // STAFF (vai trò KHÔNG đặc quyền) — seed trực tiếp DB.
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    await admin.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, default_role)
       VALUES ($1, $2, $3, 'Staff', 'STAFF')`,
      [tenantId, staffEmail, hash],
    );
  });

  afterAll(async () => {
    if (admin) {
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = $1)`, [slug]);
      await admin.query(`DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = $1)`, [slug]);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [slug]);
      await admin.end();
    }
    await app?.close();
    // Khôi phục flag (tránh rò sang file test khác chạy sau trong cùng process).
    if (prevFlag === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prevFlag;
  });

  const login = (email: string) =>
    request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', slug).send({ email, password: PASSWORD });

  it('OWNER (đặc quyền) chưa bật 2FA → 403 AUTH_2FA_REQUIRED_FOR_ROLE', async () => {
    const res = await login(ownerEmail);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_2FA_REQUIRED_FOR_ROLE');
  });

  it('STAFF (không đặc quyền) chưa bật 2FA → 200 (không bị enforce)', async () => {
    const res = await login(staffEmail);
    expect(res.status).toBe(200);
    expect(res.body.data.access_token).toBeTruthy();
  });
});
