import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import JSZip from 'jszip';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataRightsService } from '@modules/compliance/data-rights.service';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance task 7.3 (docs/12 §4 — Nghị định 13): consent (đồng ý/thu hồi);
 * data-export (zip Right to Access/Portability); data-erasure có legal-hold matrix
 * (giữ số giấy tờ tới hạn lưu trú/CCCD 5 năm); data-correction; cron ẩn danh khách
 * không booking ≥5 năm. → đóng EPIC 7.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `dr-${RUN}`;
const ownerEmail = `owner-${RUN}@e2e.test`;
const hkEmail = `hk-${RUN}@e2e.test`;

describe('Data rights NĐ13 (task 7.3)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let hkToken: string;
  let tenantId: string;
  let resourceId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const createGuest = async (fields: Record<string, unknown>): Promise<string> =>
    (await request(http).post('/api/v1/guests').set(auth()).send(fields).expect(201)).body.data.id;

  const quote = async (ci: string, co: string): Promise<string> =>
    (
      await request(http).post('/api/v1/pricing/quote').set(auth()).send({ resource_id: resourceId, mode: 'DAILY', check_in: ci, check_out: co }).expect(200)
    ).body.data.quote_id;

  const book = async (guestId: string, ci: string, co: string): Promise<string> =>
    (
      await request(http)
        .post('/api/v1/bookings')
        .set({ ...auth(), 'Idempotency-Key': randomUUID() })
        .send({ resource_id: resourceId, quote_id: await quote(ci, co), mode: 'DAILY', check_in: ci, check_out: co, guest_id: guestId })
        .expect(201)
    ).body.data.id;

  const guestRow = async (id: string) =>
    (await admin.query(`SELECT full_name, anonymized_at, legal_hold_until, id_document_number_enc, phone FROM guests WHERE id=$1`, [id])).rows[0];

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
      .send({ tenant_slug: tenantSlug, tenant_display_name: 'DR E2E', email: ownerEmail, password: PASSWORD, full_name: 'Owner' })
      .expect(201);
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id;
    token = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: ownerEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;

    const propertyId = (
      await request(http).post('/api/v1/properties').set(auth()).send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' }).expect(201)
    ).body.data.id;
    const roomId = (
      await request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: '101' }).expect(201)
    ).body.data.id;
    resourceId = (
      await request(http).get(`/api/v1/bookable-resources?property_id=${propertyId}`).set(auth()).expect(200)
    ).body.data.find((r: { room_ids: string[] }) => r.room_ids.includes(roomId)).id;
    await request(http)
      .post('/api/v1/rate-plans')
      .set(auth())
      .send({ property_id: propertyId, name: 'DAILY', mode: 'DAILY', base_price_vnd: 500_000, effective_from: '2026-01-01', resource_ids: [resourceId] })
      .expect(201);

    const hkHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const hk = await admin.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, default_role) VALUES ($1,$2,$3,'HK','HOUSEKEEPER') RETURNING id`,
      [tenantId, hkEmail, hkHash],
    );
    await admin.query(`INSERT INTO user_property_roles (tenant_id, user_id, property_id, role) VALUES ($1,$2,$3,'HOUSEKEEPER')`, [tenantId, hk.rows[0].id, propertyId]);
    hkToken = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: hkEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM data_processing_consents WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM room_occupancy WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM booking_status_history WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM quotes WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM bookings WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM rate_plans WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM idempotency_keys WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM document_counters WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM guests WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM resource_members WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM bookable_resources WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM rooms WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]); // cascade audit_logs
      await admin.end();
    }
    await app?.close();
  });

  it('consent: grant → list thấy bản ghi (có hash); revoke → revoked_at set', async () => {
    const g = await createGuest({ full_name: 'Khách Consent' });
    const grant = await request(http).post(`/api/v1/guests/${g}/consents`).set(auth()).send({ consent_type: 'BOOKING_PROCESS', consent_text: 'Tôi đồng ý xử lý dữ liệu để đặt phòng.' }).expect(201);
    expect(grant.body.data.consent_text_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(grant.body.data.revoked_at).toBeNull();

    const list = await request(http).get(`/api/v1/guests/${g}/consents`).set(auth()).expect(200);
    expect(list.body.data).toHaveLength(1);

    const rev = await request(http).post(`/api/v1/guests/${g}/consents/${grant.body.data.id}/revoke`).set(auth()).expect(200);
    expect(rev.body.data.revoked_at).not.toBeNull();
  });

  it('data-export: zip chứa profile (số giấy tờ giải mã) + consents + bookings; audit READ_PII', async () => {
    const g = await createGuest({ full_name: 'Khách Export', id_document_type: 'CCCD', id_document_number: '111122223333', phone: '0905000111' });
    await request(http).post(`/api/v1/guests/${g}/consents`).set(auth()).send({ consent_type: 'BOOKING_PROCESS', consent_text: 'đồng ý' }).expect(201);
    await book(g, '2026-08-01T07:00:00.000Z', '2026-08-03T05:00:00.000Z');

    const res = await request(http).get(`/api/v1/guests/${g}/data-export`).set(auth()).responseType('blob').expect(200);
    expect(res.headers['content-type']).toContain('application/zip');

    const zip = await JSZip.loadAsync(res.body as Buffer);
    const profile = JSON.parse(await zip.file('profile.json')!.async('string'));
    expect(profile.full_name).toBe('Khách Export');
    expect(profile.id_document_number).toBe('111122223333'); // giải mã
    const consents = JSON.parse(await zip.file('consents.json')!.async('string'));
    expect(consents).toHaveLength(1);
    const bookings = JSON.parse(await zip.file('bookings.json')!.async('string'));
    expect(bookings).toHaveLength(1);

    const audit = await admin.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id=$1 AND action='READ_PII' AND entity_type='guests' AND entity_id=$2 AND after_data->>'scope'='data-export'`,
      [tenantId, g],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it('data-erasure (có lưu trú gần đây) → ẩn danh tên/SĐT NHƯNG GIỮ số giấy tờ + legal_hold_until', async () => {
    const g = await createGuest({ full_name: 'Khách Lưu Trú', id_document_type: 'CCCD', id_document_number: '222233334444', phone: '0905222333' });
    const b = await book(g, '2026-05-01T07:00:00.000Z', '2026-05-03T05:00:00.000Z');
    await admin.query(`UPDATE bookings SET status='CHECKED_OUT', actual_check_out='2026-05-03T05:00:00Z' WHERE id=$1`, [b]);

    const res = await request(http).post(`/api/v1/guests/${g}/data-erasure`).set(auth()).expect(200);
    expect(res.body.data.anonymized).toBe(true);
    expect(res.body.data.kept).toContain('id_document'); // legal-hold giữ số giấy tờ
    expect(res.body.data.legal_hold_until).toMatch(/^2031-05-0[23]$/); // check_out + 5 năm

    const row = await guestRow(g);
    expect(row.full_name).toBe('ANONYMIZED');
    expect(row.phone).toBeNull();
    expect(row.id_document_number_enc).not.toBeNull(); // GIỮ (legal hold)
    expect(row.legal_hold_until).not.toBeNull();
  });

  it('data-erasure (không lưu trú) → ẩn danh TOÀN BỘ gồm số giấy tờ, không legal-hold', async () => {
    const g = await createGuest({ full_name: 'Khách Không Lưu Trú', id_document_type: 'CCCD', id_document_number: '555566667777' });
    const res = await request(http).post(`/api/v1/guests/${g}/data-erasure`).set(auth()).expect(200);
    expect(res.body.data.anonymized).toBe(true);
    expect(res.body.data.kept).toHaveLength(0);
    expect(res.body.data.legal_hold_until).toBeNull();

    const row = await guestRow(g);
    expect(row.full_name).toBe('ANONYMIZED');
    expect(row.id_document_number_enc).toBeNull(); // xoá hẳn
  });

  it('data-correction → sửa được tên; HOUSEKEEPER gọi data-erasure → 403', async () => {
    const g = await createGuest({ full_name: 'Tên Sai' });
    const res = await request(http).post(`/api/v1/guests/${g}/data-correction`).set(auth()).send({ full_name: 'Tên Đúng', phone: '0906000000' }).expect(200);
    expect(res.body.data.full_name).toBe('Tên Đúng');

    await request(http).post(`/api/v1/guests/${g}/data-erasure`).set({ Authorization: `Bearer ${hkToken}` }).expect(403);
  });

  it('cron anonymizeStaleForTenant: khách tạo >5 năm + không booking → ẩn danh; khách mới → giữ nguyên', async () => {
    const stale = await createGuest({ full_name: 'Khách Cũ', id_document_type: 'CCCD', id_document_number: '888899990000' });
    await admin.query(`UPDATE guests SET created_at = now() - interval '6 years' WHERE id=$1`, [stale]);
    const fresh = await createGuest({ full_name: 'Khách Mới' });

    const count = await app.get(DataRightsService).anonymizeStaleForTenant(tenantId, new Date());
    expect(count).toBeGreaterThanOrEqual(1);

    expect((await guestRow(stale)).full_name).toBe('ANONYMIZED');
    expect((await guestRow(stale)).id_document_number_enc).toBeNull();
    expect((await guestRow(fresh)).full_name).toBe('Khách Mới'); // chưa tới hạn
  });
});
