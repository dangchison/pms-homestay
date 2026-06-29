import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
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
 * ★ Acceptance B4 (docs/14 §4.7, docs/18): platform-auth module — đăng nhập admin
 * nền tảng (platform_users) qua /platform/auth/login → JWT riêng (typ 'platform',
 * ký JWT_PLATFORM_SECRET); PlatformAuthGuard bảo vệ endpoint platform (thay
 * PLATFORM_ADMIN_SECRET). Kiểm: login đúng/sai/khoá; cách ly token tenant↔platform.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const adminEmail = `padmin-${RUN}@platform.test`;
const inactiveEmail = `pinactive-${RUN}@platform.test`;
const tenantSlug = `pauth-${RUN}`;
const ownerEmail = `owner-${RUN}@e2e.test`;

describe('Platform-auth (B4)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let tenantToken: string;

  const login = (email: string, password: string) =>
    request(http).post('/api/v1/platform/auth/login').send({ email, password });

  /** POST confirm với token tuỳ ý (id ngẫu nhiên) — dùng để kiểm guard. */
  const confirm = (bearer?: string) => {
    const req = request(http).post(
      `/api/v1/platform/subscription-payments/${randomUUID()}/confirm`,
    );
    return bearer ? req.set({ Authorization: `Bearer ${bearer}` }) : req;
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

    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    await admin.query(
      `INSERT INTO platform_users (email, password_hash, full_name, is_active) VALUES ($1,$2,'Platform Admin',true)`,
      [adminEmail, hash],
    );
    await admin.query(
      `INSERT INTO platform_users (email, password_hash, full_name, is_active) VALUES ($1,$2,'Inactive Admin',false)`,
      [inactiveEmail, hash],
    );

    // Tenant + owner token — để kiểm cách ly token tenant ↔ platform.
    await request(http)
      .post('/api/v1/auth/register')
      .send({ tenant_slug: tenantSlug, tenant_display_name: 'PAUTH E2E', email: ownerEmail, password: PASSWORD, full_name: 'Owner' })
      .expect(201);
    tenantToken = (
      await request(http)
        .post('/api/v1/auth/login')
        .set('X-Tenant-Slug', tenantSlug)
        .send({ email: ownerEmail, password: PASSWORD })
        .expect(200)
    ).body.data.access_token;
  });

  afterAll(async () => {
    if (admin) {
      await admin.query(`DELETE FROM platform_users WHERE email IN ($1,$2)`, [adminEmail, inactiveEmail]);
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await app?.close();
  });

  it('login đúng → 200 + access_token + thông tin admin', async () => {
    const res = await login(adminEmail, PASSWORD).expect(200);
    const d = res.body.data;
    expect(d.token_type).toBe('Bearer');
    expect(d.expires_in).toBe(3600);
    expect(typeof d.access_token).toBe('string');
    expect(d.admin.email).toBe(adminEmail);
    expect(d.admin.full_name).toBe('Platform Admin');
  });

  it('login sai mật khẩu → 401 PLATFORM_INVALID_CREDENTIALS', async () => {
    const res = await login(adminEmail, 'sai-mat-khau-roi').expect(401);
    expect(res.body.error.code).toBe('PLATFORM_INVALID_CREDENTIALS');
  });

  it('login email không tồn tại → 401', async () => {
    await login(`khong-co-${RUN}@platform.test`, PASSWORD).expect(401);
  });

  it('login admin bị khoá (is_active=false) → 401', async () => {
    const res = await login(inactiveEmail, PASSWORD).expect(401);
    expect(res.body.error.code).toBe('PLATFORM_INVALID_CREDENTIALS');
  });

  it('guard: confirm KHÔNG token → 401 PLATFORM_UNAUTHENTICATED', async () => {
    const res = await confirm().expect(401);
    expect(res.body.error.code).toBe('PLATFORM_UNAUTHENTICATED');
  });

  it('guard: confirm bằng token TENANT → 401 (cách ly token tenant↔platform)', async () => {
    const res = await confirm(tenantToken).expect(401);
    expect(res.body.error.code).toBe('PLATFORM_TOKEN_INVALID');
  });

  it('guard: confirm bằng token platform hợp lệ → qua guard (404 payment, KHÔNG 401)', async () => {
    const platformToken = (await login(adminEmail, PASSWORD).expect(200)).body.data.access_token;
    const res = await confirm(platformToken).expect(404);
    expect(res.body.error.code).toBe('SUBSCRIPTION_PAYMENT_NOT_FOUND');
  });

  it('cách ly ngược: token platform KHÔNG dùng được trên endpoint tenant → 401', async () => {
    const platformToken = (await login(adminEmail, PASSWORD).expect(200)).body.data.access_token;
    await request(http)
      .get('/api/v1/billing/subscription')
      .set({ Authorization: `Bearer ${platformToken}` })
      .expect(401);
  });
});
