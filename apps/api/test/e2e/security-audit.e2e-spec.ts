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
 * Task 8.4 — Security audit (OWASP/IDOR). Bổ trợ `rbac.e2e` (đã cover property-scope
 * IDOR cùng tenant + pv-revoke): tập trung **cách ly cross-tenant qua HTTP (RLS)**,
 * CSRF double-submit (logout), và tính toàn vẹn token (thiếu/rác → 401).
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';

describe('Security audit (task 8.4) — tenant isolation · CSRF · token integrity', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;

  const slugA = `sec-a-${RUN}`;
  const slugB = `sec-b-${RUN}`;
  const ownerA = `owner-a-${RUN}@e2e.test`;
  const ownerB = `owner-b-${RUN}@e2e.test`;
  const propA = randomUUID();
  const propB = randomUUID();
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    const env = loadEnv();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();

    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();

    const register = (slug: string, email: string, name: string) =>
      request(http)
        .post('/api/v1/auth/register')
        .send({ tenant_slug: slug, tenant_display_name: name, email, password: PASSWORD, full_name: 'Owner' })
        .expect(201);
    await register(slugA, ownerA, 'Sec A');
    await register(slugB, ownerB, 'Sec B');

    const idA = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [slugA])).rows[0].id;
    const idB = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [slugB])).rows[0].id;
    await admin.query(
      `INSERT INTO properties (id, tenant_id, name, property_type, address_line, province)
       VALUES ($1, $2, 'Prop A', 'HOMESTAY', 'addr', 'Đà Nẵng'),
              ($3, $4, 'Prop B', 'HOMESTAY', 'addr', 'Đà Nẵng')`,
      [propA, idA, propB, idB],
    );

    const login = (slug: string, email: string) =>
      request(http)
        .post('/api/v1/auth/login')
        .set('X-Tenant-Slug', slug)
        .send({ email, password: PASSWORD })
        .expect(200);
    tokenA = (await login(slugA, ownerA)).body.data.access_token;
    tokenB = (await login(slugB, ownerB)).body.data.access_token;
  });

  afterAll(async () => {
    if (admin) {
      for (const slug of [slugA, slugB]) {
        await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = $1)`, [slug]);
        await admin.query(`DELETE FROM properties WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = $1)`, [slug]);
        await admin.query(`DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = $1)`, [slug]);
        await admin.query(`DELETE FROM tenants WHERE slug = $1`, [slug]);
      }
      await admin.end();
    }
    await app?.close();
  });

  // ── Cách ly cross-tenant (RLS qua HTTP) ──────────────────────────────────
  it('token A đọc property của tenant B (ID thật) → 404 (RLS giấu sự tồn tại)', async () => {
    await request(http).get(`/api/v1/properties/${propB}`).set('Authorization', `Bearer ${tokenA}`).expect(404);
  });

  it('sanity: token B đọc property của chính B → 200', async () => {
    await request(http).get(`/api/v1/properties/${propB}`).set('Authorization', `Bearer ${tokenB}`).expect(200);
  });

  it('list /properties của A KHÔNG chứa property của B (chỉ thấy của mình)', async () => {
    const res = await request(http).get('/api/v1/properties').set('Authorization', `Bearer ${tokenA}`).expect(200);
    const ids = (res.body.data as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain(propA);
    expect(ids).not.toContain(propB);
  });

  it('đổi X-Tenant-Slug=B nhưng dùng token A → vẫn cảnh tenant A (JWT tnt là chuẩn, không bypass) → 404', async () => {
    // jwt-auth.guard ghi đè req.tenantId = claims.tnt → header slug bị bỏ qua khi đã auth.
    await request(http)
      .get(`/api/v1/properties/${propB}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Tenant-Slug', slugB)
      .expect(404);
  });

  // ── Token integrity ──────────────────────────────────────────────────────
  it('không Bearer trên endpoint bảo vệ → 401', async () => {
    await request(http).get(`/api/v1/properties/${propA}`).set('X-Tenant-Slug', slugA).expect(401);
  });

  it('Bearer rác → 401', async () => {
    await request(http)
      .get(`/api/v1/properties/${propA}`)
      .set('Authorization', 'Bearer not.a.valid.jwt')
      .set('X-Tenant-Slug', slugA)
      .expect(401);
  });

  // ── CSRF double-submit (logout dùng refresh cookie) ──────────────────────
  const loginRaw = (email: string) =>
    request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', slugA).send({ email, password: PASSWORD });
  const cookieHeader = (res: request.Response) =>
    (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');

  it('logout THIẾU X-CSRF-Token → 403 AUTH_CSRF_MISMATCH', async () => {
    const loginRes = await loginRaw(ownerA).expect(200);
    const res = await request(http).post('/api/v1/auth/logout').set('Cookie', cookieHeader(loginRes));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_CSRF_MISMATCH');
  });

  it('logout CÓ X-CSRF-Token khớp cookie → 204', async () => {
    const loginRes = await loginRaw(ownerA).expect(200);
    await request(http)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookieHeader(loginRes))
      .set('X-CSRF-Token', loginRes.body.data.csrf_token)
      .expect(204);
  });
});
