import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import ExcelJS from 'exceljs';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance task 7.2 (docs/12 §2): GET /compliance/police-report → Excel TT56;
 * decrypt số giấy tờ theo batch + 1 audit READ_PII scope report; chỉ khách đã lưu trú
 * (CHECKED_IN/CHECKED_OUT) trong [from,to]. Quyền guest.pii.read + property-scope.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `police-${RUN}`;
const ownerEmail = `owner-${RUN}@e2e.test`;
const hkEmail = `hk-${RUN}@e2e.test`;

const ID_NUMBER = '012345678901';

/** Gộp toàn bộ text trong sheet đầu để assert nội dung. */
async function sheetText(buffer: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0]!;
  let text = '';
  ws.eachRow((row) => row.eachCell((cell) => (text += `${String(cell.value ?? '')}|`)));
  return text;
}

describe('Police report export (task 7.2)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let hkToken: string;
  let tenantId: string;
  let propertyId: string;
  let resourceId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

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

  const report = (from: string, to: string, tok = token) =>
    request(http)
      .get(`/api/v1/compliance/police-report?property_id=${propertyId}&from=${from}&to=${to}`)
      .set({ Authorization: `Bearer ${tok}` });

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
      .send({ tenant_slug: tenantSlug, tenant_display_name: 'POLICE E2E', email: ownerEmail, password: PASSWORD, full_name: 'Owner' })
      .expect(201);
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id;
    token = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: ownerEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;

    propertyId = (
      await request(http).post('/api/v1/properties').set(auth()).send({ name: 'Homestay Đà Nẵng', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' }).expect(201)
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

    // Housekeeper (KHÔNG có guest.pii.read) — kiểm 403.
    const hkHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const hk = await admin.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, default_role) VALUES ($1,$2,$3,'HK','HOUSEKEEPER') RETURNING id`,
      [tenantId, hkEmail, hkHash],
    );
    await admin.query(`INSERT INTO user_property_roles (tenant_id, user_id, property_id, role) VALUES ($1,$2,$3,'HOUSEKEEPER')`, [tenantId, hk.rows[0].id, propertyId]);
    hkToken = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: hkEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;

    // Guest đã lưu trú (CHECKED_IN, check_in trong tháng 9) — sẽ xuất hiện.
    const guestStayed = (
      await request(http).post('/api/v1/guests').set(auth()).send({
        full_name: 'Nguyễn Văn Lưu Trú', phone: '0905111222', nationality: 'VN', gender: 'Nam', date_of_birth: '1990-03-15',
        id_document_type: 'CCCD', id_document_number: ID_NUMBER, id_document_issue_date: '2021-01-20', id_document_issue_place: 'Cục CS', address: 'Hải Châu, Đà Nẵng',
      }).expect(201)
    ).body.data.id;
    const bStayed = await book(guestStayed, '2026-09-10T07:00:00.000Z', '2026-09-12T05:00:00.000Z');
    await admin.query(`UPDATE bookings SET status='CHECKED_IN', actual_check_in=now() WHERE id=$1`, [bStayed]);

    // Guest mới đặt (PENDING, trong tháng 9) — KHÔNG lưu trú → bị loại.
    const guestPending = (
      await request(http).post('/api/v1/guests').set(auth()).send({ full_name: 'Trần Văn Chưa Đến', nationality: 'VN', id_document_type: 'CCCD', id_document_number: '999888777666' }).expect(201)
    ).body.data.id;
    await book(guestPending, '2026-09-15T07:00:00.000Z', '2026-09-17T05:00:00.000Z'); // để PENDING
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
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
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]); // cascade audit_logs (4.5)
      await admin.end();
    }
    await app?.close();
  });

  it('xuất Excel khách đã lưu trú trong kỳ + số giấy tờ ĐÃ giải mã; loại khách PENDING', async () => {
    const res = await report('2026-09-01', '2026-09-30').responseType('blob').expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toContain('attachment');

    const text = await sheetText(res.body as Buffer);
    expect(text).toContain('Nguyễn Văn Lưu Trú');
    expect(text).toContain(ID_NUMBER); // số giấy tờ giải mã (KHÔNG ****)
    expect(text).toContain('Thông tư 56'); // tiêu đề
    expect(text).not.toContain('Trần Văn Chưa Đến'); // PENDING → loại
  });

  it('ghi đúng 1 audit READ_PII scope police-report cho mỗi lần export', async () => {
    const before = (
      await admin.query(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id=$1 AND action='READ_PII' AND entity_type='police-report'`, [tenantId])
    ).rows[0].n;
    await report('2026-09-01', '2026-09-30').responseType('blob').expect(200);
    const after = await admin.query(
      `SELECT count(*)::int AS n, max(after_data->>'guest_count') AS gc FROM audit_logs WHERE tenant_id=$1 AND action='READ_PII' AND entity_type='police-report'`,
      [tenantId],
    );
    expect(after.rows[0].n).toBe(before + 1);
    expect(after.rows[0].gc).toBe('1'); // đúng 1 khách lưu trú
  });

  it('kỳ ngoài phạm vi (tháng 10) → báo cáo rỗng (chỉ header), vẫn 200', async () => {
    const res = await report('2026-10-01', '2026-10-31').responseType('blob').expect(200);
    const text = await sheetText(res.body as Buffer);
    expect(text).toContain('Thông tư 56');
    expect(text).not.toContain('Nguyễn Văn Lưu Trú'); // ngoài kỳ check-in
  });

  it('HOUSEKEEPER (không guest.pii.read) → 403', async () => {
    await report('2026-09-01', '2026-09-30', hkToken).expect(403);
  });

  it('from > to → 400 VALIDATION_FAILED', async () => {
    await report('2026-09-30', '2026-09-01').expect(400);
  });
});
