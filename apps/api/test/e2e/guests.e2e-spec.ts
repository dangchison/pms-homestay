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
 * ★ Acceptance task 2.5 (ADR-0007): guests CRUD; số giấy tờ mã hoá field
 * (KHÔNG plaintext) — list/get chỉ ****last4; search exact qua blind index hash;
 * endpoint xem số đầy đủ (decrypt + audit READ_PII); blacklist.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `gu-${RUN}`;
const DOC = '012345678901';

describe('Guests + PII encryption (task 2.5)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let guestId: string;

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
        tenant_display_name: 'GU E2E',
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
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM guests WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await app?.close();
  });

  it('tạo khách → 201, chỉ trả ****last4 (KHÔNG có số đầy đủ)', async () => {
    const res = await request(http)
      .post('/api/v1/guests')
      .set(auth())
      .send({
        full_name: 'Nguyễn Văn A',
        phone: '0905123456',
        id_document_type: 'CCCD',
        id_document_number: DOC,
      })
      .expect(201);
    guestId = res.body.data.id;
    expect(res.body.data.id_document_last4).toBe('8901');
    expect(res.body.data.id_document_masked).toBe('****8901');
    expect(res.body.data.id_document_number).toBeUndefined(); // không lộ số đầy đủ
  });

  it('DB lưu BYTEA mã hoá (key_id prefix), KHÔNG plaintext', async () => {
    const { rows } = await admin.query(
      `SELECT convert_from(id_document_number_enc, 'UTF8') AS enc_text,
              id_document_number_hash IS NOT NULL AS has_hash,
              id_document_last4 AS last4
       FROM guests WHERE id = $1`,
      [guestId],
    );
    expect(rows[0].enc_text.startsWith('k1:')).toBe(true); // payload AES-GCM (ADR-0007)
    expect(rows[0].enc_text).not.toContain(DOC); // số gốc không xuất hiện
    expect(rows[0].has_hash).toBe(true);
    expect(rows[0].last4).toBe('8901');
  });

  it('search ?q= theo tên (trgm) + ?id_document_number exact qua hash (chuẩn hoá khoảng trắng)', async () => {
    const byName = await request(http).get('/api/v1/guests?q=Nguyễn').set(auth()).expect(200);
    expect(byName.body.data.some((g: { id: string }) => g.id === guestId)).toBe(true);

    // có khoảng trắng → normalizeDoc khớp cùng hash
    const byDoc = await request(http)
      .get('/api/v1/guests?id_document_number=012%20345%20678%20901')
      .set(auth())
      .expect(200);
    expect(byDoc.body.data).toHaveLength(1);
    expect(byDoc.body.data[0].id).toBe(guestId);

    const miss = await request(http)
      .get('/api/v1/guests?id_document_number=999999999999')
      .set(auth())
      .expect(200);
    expect(miss.body.data).toHaveLength(0);
  });

  it('xem số giấy tờ đầy đủ → decrypt trả đúng số gốc (quyền guest.pii.read)', async () => {
    const res = await request(http)
      .get(`/api/v1/guests/${guestId}/id-document`)
      .set(auth())
      .expect(200);
    expect(res.body.data.id_document_number).toBe(DOC);
    expect(res.body.data.id_document_type).toBe('CCCD');
  });

  it('cập nhật + blacklist/unblacklist', async () => {
    const upd = await request(http)
      .patch(`/api/v1/guests/${guestId}`)
      .set(auth())
      .send({ phone: '0911222333', notes: 'khách quen' })
      .expect(200);
    expect(upd.body.data.phone).toBe('0911222333');

    const bl = await request(http)
      .post(`/api/v1/guests/${guestId}/blacklist`)
      .set(auth())
      .send({ reason: 'gây rối' })
      .expect(201);
    expect(bl.body.data.is_blacklisted).toBe(true);
    expect(bl.body.data.blacklist_reason).toBe('gây rối');

    const unbl = await request(http)
      .post(`/api/v1/guests/${guestId}/unblacklist`)
      .set(auth())
      .expect(201);
    expect(unbl.body.data.is_blacklisted).toBe(false);
    expect(unbl.body.data.blacklist_reason).toBeNull();
  });

  it('xoá mềm → GET trả 404', async () => {
    await request(http).delete(`/api/v1/guests/${guestId}`).set(auth()).expect(204);
    await request(http).get(`/api/v1/guests/${guestId}`).set(auth()).expect(404);
  });
});
