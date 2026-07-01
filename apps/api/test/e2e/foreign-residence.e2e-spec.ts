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
 * ★ Acceptance task 9.3 (docs/12 §2): khai báo TẠM TRÚ khách NƯỚC NGOÀI (mẫu NA17, XNC).
 * CRUD dữ liệu visa/nhập cảnh per-stay (1 khai báo/booking), "Gửi" lên XNC (STUB), xuất
 * phiếu NA17 (giải mã số thị thực + hộ chiếu + audit READ_PII). Số thị thực mã hoá field
 * → list/get chỉ trả last4. Quyền guest.pii.read + property-scope. KHÁC báo cáo TT56.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `foreign-${RUN}`;
const ownerEmail = `owner-${RUN}@e2e.test`;
const hkEmail = `hk-${RUN}@e2e.test`;

const PASSPORT = 'P12345678';
const VISA_NUMBER = 'VN1234567';

async function sheetText(buffer: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0]!;
  let text = '';
  ws.eachRow((row) => row.eachCell((cell) => (text += `${String(cell.value ?? '')}|`)));
  return text;
}

describe('Foreign residence declaration NA17 (task 9.3)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let hkToken: string;
  let tenantId: string;
  let propertyId: string;
  let resourceId: string;
  let bookingA: string; // khách NN đủ dữ liệu
  let bookingB: string; // thiếu dữ liệu → FAILED khi submit
  let bookingNoGuest: string; // booking bị gỡ guest → 422
  let declA: string;
  let declB: string;

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

  const createGuest = async (payload: Record<string, unknown>): Promise<string> =>
    (await request(http).post('/api/v1/guests').set(auth()).send(payload).expect(201)).body.data.id;

  const decl = (path = '', tok = token) =>
    request(http).post(`/api/v1/compliance/foreign-residence${path}`).set({ Authorization: `Bearer ${tok}` });

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
      .send({ tenant_slug: tenantSlug, tenant_display_name: 'FOREIGN E2E', email: ownerEmail, password: PASSWORD, full_name: 'Owner' })
      .expect(201);
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id;
    token = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: ownerEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;

    propertyId = (
      await request(http).post('/api/v1/properties').set(auth()).send({ name: 'Homestay Đà Nẵng', property_type: 'HOMESTAY', address_line: '12 Bạch Đằng', ward: 'Hải Châu 1', district: 'Hải Châu', province: 'Đà Nẵng' }).expect(201)
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

    const guestA = await createGuest({
      full_name: 'John Foreign', gender: 'Nam', nationality: 'US', date_of_birth: '1988-05-10',
      id_document_type: 'PASSPORT', id_document_number: PASSPORT,
    });
    bookingA = await book(guestA, '2026-09-10T07:00:00.000Z', '2026-09-12T05:00:00.000Z');

    const guestB = await createGuest({ full_name: 'Mary Foreign', nationality: 'GB', id_document_type: 'PASSPORT', id_document_number: 'P87654321' });
    bookingB = await book(guestB, '2026-09-15T07:00:00.000Z', '2026-09-17T05:00:00.000Z');

    const guestC = await createGuest({ full_name: 'Tom NoGuest', nationality: 'FR', id_document_type: 'PASSPORT', id_document_number: 'P55554444' });
    bookingNoGuest = await book(guestC, '2026-09-20T07:00:00.000Z', '2026-09-22T05:00:00.000Z');
    // Gỡ guest khỏi booking để test nhánh BOOKING_NO_GUEST (superuser bypass RLS).
    await admin.query(`UPDATE bookings SET guest_id = NULL WHERE id = $1`, [bookingNoGuest]);
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM foreign_residence_declarations WHERE tenant_id IN ${tid}`);
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
      await admin.query(`DELETE FROM notifications WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]); // cascade audit_logs (4.5)
      await admin.end();
    }
    await app?.close();
  });

  it('tạo khai báo (DRAFT) → chỉ trả visa last4 (masked), không lộ số đầy đủ', async () => {
    const res = await decl().send({ booking_id: bookingA, visa_number: VISA_NUMBER, visa_type: 'DL', visa_expiry: '2026-12-31' }).expect(201);
    declA = res.body.data.id;
    expect(res.body.data).toMatchObject({ booking_id: bookingA, property_id: propertyId, status: 'DRAFT', visa_number_last4: '4567', visa_type: 'DL' });
    expect(res.body.data.visa_number).toBeUndefined(); // KHÔNG bao giờ trả số đầy đủ
  });

  it('auto-audit CREATE redact visa_number ([REDACTED]) — không lưu plaintext', async () => {
    const row = await admin.query(
      `SELECT after_data FROM audit_logs WHERE tenant_id=$1 AND entity_type='compliance' AND action='CREATE' ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    expect(row.rows[0].after_data.visa_number).toBe('[REDACTED]');
  });

  it('DB lưu visa_number_enc mã hoá (KHÔNG plaintext) + last4', async () => {
    const row = await admin.query(`SELECT visa_number_enc, visa_number_last4 FROM foreign_residence_declarations WHERE id=$1`, [declA]);
    expect(row.rows[0].visa_number_last4).toBe('4567');
    const enc = row.rows[0].visa_number_enc as Buffer;
    expect(enc).not.toBeNull();
    expect(enc.toString('utf8')).not.toContain(VISA_NUMBER); // payload mã hoá, không chứa số gốc
  });

  it('trùng booking → 409 FOREIGN_RESIDENCE_EXISTS', async () => {
    await decl().send({ booking_id: bookingA, visa_type: 'DL' }).expect(409);
  });

  it('booking không tồn tại → 404 BOOKING_NOT_FOUND', async () => {
    await decl().send({ booking_id: randomUUID(), visa_type: 'DL' }).expect(404);
  });

  it('booking không có guest → 422 BOOKING_NO_GUEST', async () => {
    await decl().send({ booking_id: bookingNoGuest, visa_type: 'DL' }).expect(422);
  });

  it('cập nhật khi DRAFT — bổ sung ngày nhập cảnh/dự kiến rời', async () => {
    const res = await request(http)
      .patch(`/api/v1/compliance/foreign-residence/${declA}`)
      .set(auth())
      .send({ date_of_entry: '2026-09-09', intended_departure: '2026-09-12', port_of_entry: 'Sân bay Đà Nẵng' })
      .expect(200);
    expect(res.body.data).toMatchObject({ date_of_entry: '2026-09-09', intended_departure: '2026-09-12', port_of_entry: 'Sân bay Đà Nẵng', status: 'DRAFT' });
  });

  it('cập nhật body rỗng → 400 VALIDATION_FAILED', async () => {
    await request(http).patch(`/api/v1/compliance/foreign-residence/${declA}`).set(auth()).send({}).expect(400);
  });

  it('list theo cơ sở + lọc status=DRAFT', async () => {
    const all = await request(http).get(`/api/v1/compliance/foreign-residence?property_id=${propertyId}`).set(auth()).expect(200);
    expect(all.body.data.some((d: { id: string }) => d.id === declA)).toBe(true);
    const draft = await request(http).get(`/api/v1/compliance/foreign-residence?property_id=${propertyId}&status=DRAFT`).set(auth()).expect(200);
    expect(draft.body.data.every((d: { status: string }) => d.status === 'DRAFT')).toBe(true);
  });

  it('get by id → masked last4', async () => {
    const res = await request(http).get(`/api/v1/compliance/foreign-residence/${declA}`).set(auth()).expect(200);
    expect(res.body.data.visa_number_last4).toBe('4567');
    expect(res.body.data.visa_number).toBeUndefined();
  });

  it('submit đủ dữ liệu → SUBMITTED (submitted_at set) + audit STATE_CHANGE', async () => {
    const res = await decl(`/${declA}/submit`).expect(200);
    expect(res.body.data).toMatchObject({ id: declA, status: 'SUBMITTED', failure_reason: null });

    const row = await admin.query(`SELECT status, submitted_at, submitted_by FROM foreign_residence_declarations WHERE id=$1`, [declA]);
    expect(row.rows[0].status).toBe('SUBMITTED');
    expect(row.rows[0].submitted_at).not.toBeNull();
    expect(row.rows[0].submitted_by).not.toBeNull();

    const audit = await admin.query(
      `SELECT after_data FROM audit_logs WHERE tenant_id=$1 AND action='STATE_CHANGE' AND entity_type='foreign-residence' ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    expect(audit.rows[0].after_data.scope).toBe('foreign-residence-submit');
    expect(audit.rows[0].after_data.status).toBe('SUBMITTED');
  });

  it('submit lần 2 (đã SUBMITTED) → idempotent, trả nguyên trạng', async () => {
    const res = await decl(`/${declA}/submit`).expect(200);
    expect(res.body.data).toMatchObject({ id: declA, status: 'SUBMITTED' });
  });

  it('cập nhật sau khi SUBMITTED → 422 FOREIGN_RESIDENCE_SUBMITTED', async () => {
    await request(http).patch(`/api/v1/compliance/foreign-residence/${declA}`).set(auth()).send({ visa_type: 'DN' }).expect(422);
  });

  it('xuất NA17 → xlsx có số thị thực + hộ chiếu ĐÃ giải mã + audit READ_PII', async () => {
    const before = (
      await admin.query(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id=$1 AND action='READ_PII' AND entity_type='foreign-residence'`, [tenantId])
    ).rows[0].n;

    const res = await request(http).get(`/api/v1/compliance/foreign-residence/${declA}/na17`).set(auth()).responseType('blob').expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toContain('attachment');

    const text = await sheetText(res.body as Buffer);
    expect(text).toContain('Mẫu NA17');
    expect(text).toContain('John Foreign');
    expect(text).toContain(VISA_NUMBER); // số thị thực giải mã (KHÔNG ****)
    expect(text).toContain(PASSPORT); // số hộ chiếu (guest) giải mã
    expect(text).toContain('Đà Nẵng'); // nơi tạm trú = địa chỉ cơ sở

    const after = (
      await admin.query(`SELECT count(*)::int AS n, max(after_data->>'scope') AS scope FROM audit_logs WHERE tenant_id=$1 AND action='READ_PII' AND entity_type='foreign-residence'`, [tenantId])
    ).rows[0];
    expect(after.n).toBe(before + 1);
    expect(after.scope).toBe('foreign-residence-na17');
  });

  it('submit thiếu dữ liệu → FAILED kèm lý do', async () => {
    const res = await decl().send({ booking_id: bookingB }).expect(201);
    declB = res.body.data.id;
    const sub = await decl(`/${declB}/submit`).expect(200);
    expect(sub.body.data.status).toBe('FAILED');
    expect(sub.body.data.failure_reason).toContain('date_of_entry');
    expect(sub.body.data.failure_reason).toContain('intended_departure');
    expect(sub.body.data.failure_reason).toContain('visa');
  });

  it('HOUSEKEEPER (không guest.pii.read) → 403 khi tạo/list/xuất NA17', async () => {
    await decl('', hkToken).send({ booking_id: bookingB, visa_type: 'DL' }).expect(403);
    await request(http).get(`/api/v1/compliance/foreign-residence?property_id=${propertyId}`).set({ Authorization: `Bearer ${hkToken}` }).expect(403);
    await request(http).get(`/api/v1/compliance/foreign-residence/${declA}/na17`).set({ Authorization: `Bearer ${hkToken}` }).expect(403);
  });
});
