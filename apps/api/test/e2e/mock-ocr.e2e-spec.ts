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
 * ★ Acceptance Đợt 4 / M3 (docs/18): MockOcrProvider — OCR_PROVIDER=mock chạy end-to-end
 * KHÔNG cần credentials FPT.AI. POST /guests/scan-id với image_key hợp lệ → 200 +
 * document_number 12 chữ số; 2 lần CÙNG image_key → CÙNG document_number (determinism từ
 * SHA-256 image_key); count guests KHÔNG đổi trước/sau (no-persist, ADR-0007). Guard
 * tenant-prefix vẫn 400. REST không đổi (@RequirePermissions('booking.create'), @HttpCode 200).
 */
const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `ocrmock-${RUN}`;
const ownerEmail = `owner-${RUN}@e2e.test`;

describe('OCR CCCD scan-id — MockOcrProvider (M3, OCR_PROVIDER=mock)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let tenantId: string;
  let prevOcrProvider: string | undefined;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const guestCount = async (): Promise<number> =>
    (await admin.query(`SELECT count(*)::int AS n FROM guests WHERE tenant_id = $1`, [tenantId])).rows[0].n;

  beforeAll(async () => {
    prevOcrProvider = process.env.OCR_PROVIDER;
    process.env.OCR_PROVIDER = 'mock'; // TRƯỚC loadEnv() (pattern mock-gateway/outbound-messages)
    const env = loadEnv();
    expect(env.OCR_PROVIDER).toBe('mock');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();

    await request(http)
      .post('/api/v1/auth/register')
      .send({ tenant_slug: tenantSlug, tenant_display_name: 'OCR Mock E2E', email: ownerEmail, password: PASSWORD, full_name: 'Owner' })
      .expect(201);
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id;
    token = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: ownerEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM guests WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await app?.close();
    // Khôi phục env để không rò sang spec khác chạy chung process.
    if (prevOcrProvider === undefined) delete process.env.OCR_PROVIDER;
    else process.env.OCR_PROVIDER = prevOcrProvider;
  });

  it('POST /guests/scan-id (mock) → 200 + document_number 12 chữ số; KHÔNG cần FPT key', async () => {
    const before = await guestCount();
    const r = await request(http)
      .post('/api/v1/guests/scan-id')
      .set(auth())
      .send({ image_key: `cccd/${tenantId}/abc/front.jpg` })
      .expect(200);
    expect(r.body.data.document_number).toMatch(/^\d{12}$/);
    expect(r.body.data.document_type).toBe('CCCD');
    expect(r.body.data.nationality).toBe('VN');
    expect(r.body.data.date_of_birth).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.body.data.issue_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.body.data.full_name).toBeTruthy();
    // No-persist (ADR-0007): scan KHÔNG ghi DB.
    expect(await guestCount()).toBe(before);
  });

  it('2 lần CÙNG image_key → CÙNG document_number (determinism SHA-256 image_key)', async () => {
    const key = `cccd/${tenantId}/deterministic/front.jpg`;
    const first = await request(http).post('/api/v1/guests/scan-id').set(auth()).send({ image_key: key }).expect(200);
    const second = await request(http).post('/api/v1/guests/scan-id').set(auth()).send({ image_key: key }).expect(200);
    expect(first.body.data.document_number).toBe(second.body.data.document_number);
    expect(first.body.data).toEqual(second.body.data); // toàn bộ payload tất định
  });

  it('2 image_key KHÁC nhau → document_number KHÁC nhau', async () => {
    const a = await request(http).post('/api/v1/guests/scan-id').set(auth()).send({ image_key: `cccd/${tenantId}/k1/front.jpg` }).expect(200);
    const b = await request(http).post('/api/v1/guests/scan-id').set(auth()).send({ image_key: `cccd/${tenantId}/k2/front.jpg` }).expect(200);
    expect(a.body.data.document_number).not.toBe(b.body.data.document_number);
  });

  it('image_key sai tenant prefix → 400 (guard giữ nguyên, kể cả provider mock)', async () => {
    await request(http)
      .post('/api/v1/guests/scan-id')
      .set(auth())
      .send({ image_key: 'cccd/00000000-0000-0000-0000-000000000000/abc/front.jpg' })
      .expect(400);
  });
});
