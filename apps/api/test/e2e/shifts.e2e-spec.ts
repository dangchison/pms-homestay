import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance TASK 9.4 (docs/16 #10 — Wave 1 chống thất thoát tiền mặt): sổ quỹ ca.
 * Mở ca (float) → thu tiền mặt trong ca (payment CASH gắn cơ sở qua booking) → đóng
 * ca đếm tiền → expected = float + Σ CASH − Σ refund; variance = counted − expected;
 * chênh lệch != 0 → outbox 'shift.variance_detected'. RBAC mở/đóng ca: payment.reconcile
 * — nay gồm cả STAFF thu ngân (task 2.10a), ngoài OWNER/ACCOUNTANT; đọc (list/detail) cần
 * report.financial nên STAFF vẫn KHÔNG đọc được ca. Partial-unique 1 ca OPEN/cơ sở;
 * If-Match optimistic khi đóng.
 *
 * Payment CASH chính xác số tiền: ad-hoc ADJUSTMENT invoice GẮN booking (để có
 * property qua invoices→bookings.property_id) → pay CASH đúng số. received_at = now()
 * lúc ghi payment → nằm trong cửa sổ ca đang mở.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const slugA = `shift-a-${RUN}`;
const slugB = `shift-b-${RUN}`;
const ownerA = `owner-a-${RUN}@e2e.test`;
const ownerB = `owner-b-${RUN}@e2e.test`;
const hkEmail = `hk-${RUN}@e2e.test`;
const staffEmail = `staff-${RUN}@e2e.test`;

describe('Cash shifts (task 9.4, docs/16 #10)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string; // owner tenant A (có payment.reconcile + report.financial)
  let hkToken: string; // HOUSEKEEPER tenant A (thiếu cả hai quyền)
  let staffToken: string; // STAFF tenant A (có payment.reconcile — thu ngân; thiếu report.financial)
  let tokenB: string; // owner tenant B (cross-tenant)
  let propertyId: string;
  let resDeposit: string;
  let bookingId: string; // booking neo cho ad-hoc invoice (gắn property)

  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

  /** Ad-hoc ADJUSTMENT invoice GẮN booking (issue ngay) — để payment gắn cơ sở. */
  const adhocInvoice = async (unitPrice: number): Promise<string> => {
    const res = await request(http)
      .post('/api/v1/invoices')
      .set(auth())
      .send({
        booking_id: bookingId,
        kind: 'ADJUSTMENT',
        issue: true,
        items: [{ item_type: 'SURCHARGE', description: 'Thu tiền mặt', quantity: 1, unit_price_vnd: unitPrice }],
      })
      .expect(201);
    return res.body.data.id as string;
  };

  /** Thu tiền mặt đúng số vào 1 invoice ad-hoc mới → payment CASH SUCCEEDED. */
  const payCash = async (amount: number): Promise<{ id: string; invoiceId: string }> => {
    const invoiceId = await adhocInvoice(amount);
    const res = await request(http)
      .post('/api/v1/payments')
      .set({ ...auth(), 'Idempotency-Key': randomUUID() })
      .send({ invoice_id: invoiceId, amount_vnd: amount, method: 'CASH' })
      .expect(201);
    return { id: res.body.data.id as string, invoiceId };
  };

  const openShift = (float: number, t = token, key = randomUUID()) =>
    request(http)
      .post('/api/v1/shifts')
      .set({ ...auth(t), 'Idempotency-Key': key })
      .send({ property_id: propertyId, opening_float_vnd: float });

  const closeShift = (id: string, counted: number, version: number, t = token) =>
    request(http)
      .post(`/api/v1/shifts/${id}/close`)
      .set({ ...auth(t), 'If-Match': String(version) })
      .send({ closing_counted_vnd: counted });

  const outboxVariance = async (shiftId: string) =>
    admin.query(
      `SELECT event_type, aggregate_type, aggregate_id, payload FROM outbox_events
       WHERE aggregate_id = $1 AND event_type = 'shift.variance_detected'`,
      [shiftId],
    );

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
    await register(slugA, ownerA, 'SHIFT A');
    await register(slugB, ownerB, 'SHIFT B');

    const login = (slug: string, email: string) =>
      request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', slug).send({ email, password: PASSWORD }).expect(200);
    token = (await login(slugA, ownerA)).body.data.access_token;
    tokenB = (await login(slugB, ownerB)).body.data.access_token;
    const tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [slugA])).rows[0].id as string;

    propertyId = (
      await request(http)
        .post('/api/v1/properties')
        .set(auth())
        .send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' })
        .expect(201)
    ).body.data.id;
    const room1 = (
      await request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: '101' }).expect(201)
    ).body.data.id;
    resDeposit = (
      await request(http).get(`/api/v1/bookable-resources?property_id=${propertyId}`).set(auth()).expect(200)
    ).body.data.find((r: { room_ids: string[] }) => r.room_ids.includes(room1)).id;
    await request(http)
      .post('/api/v1/rate-plans')
      .set(auth())
      .send({
        property_id: propertyId,
        name: 'Cọc 30%',
        mode: 'DAILY',
        base_price_vnd: 500_000,
        effective_from: '2026-01-01',
        deposit_type: 'PERCENT',
        deposit_value: 3000,
        resource_ids: [resDeposit],
      })
      .expect(201);

    // Booking neo (để ad-hoc invoice gắn property qua invoices→bookings.property_id).
    const ci = '2027-09-01T07:00:00.000Z';
    const co = '2027-09-03T05:00:00.000Z';
    const quoteId = (
      await request(http)
        .post('/api/v1/pricing/quote')
        .set(auth())
        .send({ resource_id: resDeposit, mode: 'DAILY', check_in: ci, check_out: co })
        .expect(200)
    ).body.data.quote_id;
    bookingId = (
      await request(http)
        .post('/api/v1/bookings')
        .set({ ...auth(), 'Idempotency-Key': randomUUID() })
        .send({ resource_id: resDeposit, quote_id: quoteId, mode: 'DAILY', check_in: ci, check_out: co })
        .expect(201)
    ).body.data.id;

    // HOUSEKEEPER tenant A (thiếu payment.reconcile + report.financial) cho test 403.
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const hk = await admin.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, default_role) VALUES ($1,$2,$3,'Buồng phòng','HOUSEKEEPER') RETURNING id`,
      [tenantId, hkEmail, hash],
    );
    await admin.query(`INSERT INTO user_property_roles (tenant_id, user_id, property_id, role) VALUES ($1,$2,$3,'HOUSEKEEPER')`, [
      tenantId,
      hk.rows[0].id,
      propertyId,
    ]);
    hkToken = (await login(slugA, hkEmail)).body.data.access_token;

    // STAFF thu ngân tenant A gán ĐÚNG property (có payment.reconcile → mở/đóng ca;
    // thiếu report.financial → không đọc ca). Seed trên propertyId để qua cả pha-2
    // authorizeOnProperty (task 2.10a).
    const staff = await admin.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, default_role) VALUES ($1,$2,$3,'Thu ngân','STAFF') RETURNING id`,
      [tenantId, staffEmail, hash],
    );
    await admin.query(`INSERT INTO user_property_roles (tenant_id, user_id, property_id, role) VALUES ($1,$2,$3,'STAFF')`, [
      tenantId,
      staff.rows[0].id,
      propertyId,
    ]);
    staffToken = (await login(slugA, staffEmail)).body.data.access_token;
  });

  afterAll(async () => {
    if (admin) {
      for (const slug of [slugA, slugB]) {
        const tid = `(SELECT id FROM tenants WHERE slug = '${slug}')`;
        // notifications: outbox dispatcher fan-out shift.variance_detected → alert (FK user).
        await admin.query(`DELETE FROM notifications WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM cash_shifts WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM payment_attempts WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM payments WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM invoice_items WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM invoices WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM room_occupancy WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM booking_status_history WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM quotes WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM bookings WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM rate_plans WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM resource_members WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM bookable_resources WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM rooms WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM idempotency_keys WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM document_counters WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM tenants WHERE slug = $1`, [slug]);
      }
      await admin.end();
    }
    await app?.close();
  });

  it('★ ca khớp: float 500k + 2 CASH (200k+300k) → đếm 1_000_000 → variance 0, KHÔNG outbox', async () => {
    const shift = (await openShift(500_000).expect(201)).body.data;
    expect(shift.status).toBe('OPEN');
    expect(shift.opening_float_vnd).toBe(500_000);
    expect(shift.expected_cash_vnd).toBeNull();
    expect(shift.variance_vnd).toBeNull();

    await payCash(200_000);
    await payCash(300_000);

    const closed = (await closeShift(shift.id, 1_000_000, shift.version).expect(200)).body.data;
    expect(closed.status).toBe('CLOSED');
    expect(closed.expected_cash_vnd).toBe(1_000_000); // 500k + 200k + 300k
    expect(closed.closing_counted_vnd).toBe(1_000_000);
    expect(closed.variance_vnd).toBe(0);

    const { rows } = await outboxVariance(shift.id);
    expect(rows.length).toBe(0); // ca khớp → KHÔNG emit
  });

  it('★ ca lệch (thiếu tiền): float 0 + CASH 500k → đếm 400_000 → variance −100_000 + 1 outbox', async () => {
    const shift = (await openShift(0).expect(201)).body.data;
    await payCash(500_000);

    const closed = (await closeShift(shift.id, 400_000, shift.version).expect(200)).body.data;
    expect(closed.expected_cash_vnd).toBe(500_000);
    expect(closed.variance_vnd).toBe(-100_000); // 400k − 500k

    const { rows } = await outboxVariance(shift.id);
    expect(rows.length).toBe(1);
    expect(rows[0].event_type).toBe('shift.variance_detected');
    expect(rows[0].aggregate_type).toBe('cash_shift');
    expect(rows[0].aggregate_id).toBe(shift.id);
    expect(rows[0].payload.variance_vnd).toBe(-100_000);
    expect(rows[0].payload.property_id).toBe(propertyId);
    expect(rows[0].payload.shift_id).toBe(shift.id);
  });

  it('★ refund CASH trong ca trừ expected đúng: CASH 300k − refund 100k → đếm 200_000 → variance 0', async () => {
    const shift = (await openShift(0).expect(201)).body.data;
    const { id: paymentId } = await payCash(300_000);
    await request(http)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set(auth())
      .send({ amount_vnd: 100_000, reason: 'Khách trả lại' })
      .expect(200);

    const closed = (await closeShift(shift.id, 200_000, shift.version).expect(200)).body.data;
    expect(closed.expected_cash_vnd).toBe(200_000); // 300k − 100k
    expect(closed.variance_vnd).toBe(0);

    const { rows } = await outboxVariance(shift.id);
    expect(rows.length).toBe(0);
  });

  it('★ ca thứ 2 khi đang OPEN cùng cơ sở → 409 SHIFT_ALREADY_OPEN; sau close #1 mở lại 201', async () => {
    const shift = (await openShift(0).expect(201)).body.data;

    const conflict = await openShift(0).expect(409);
    expect(conflict.body.error.code).toBe('SHIFT_ALREADY_OPEN');

    await closeShift(shift.id, 0, shift.version).expect(200);

    const reopened = await openShift(0).expect(201); // đóng #1 xong mở lại được
    // dọn ngay ca vừa mở để không kẹt OPEN cho test khác (mỗi test dùng property chung)
    await closeShift(reopened.body.data.id, 0, reopened.body.data.version).expect(200);
  });

  it('cross-tenant: tenant B GET /shifts/:id của tenant A → 404 SHIFT_NOT_FOUND', async () => {
    const shift = (await openShift(0).expect(201)).body.data;
    await closeShift(shift.id, 0, shift.version).expect(200);

    const res = await request(http).get(`/api/v1/shifts/${shift.id}`).set(auth(tokenB)).expect(404);
    expect(res.body.error.code).toBe('SHIFT_NOT_FOUND');
  });

  it('HOUSEKEEPER (thiếu payment.reconcile) → POST /shifts và /shifts/:id/close → 403', async () => {
    // mở ca hợp lệ bằng owner để có id đóng thử
    const shift = (await openShift(0).expect(201)).body.data;

    await request(http)
      .post('/api/v1/shifts')
      .set({ ...auth(hkToken), 'Idempotency-Key': randomUUID() })
      .send({ property_id: propertyId, opening_float_vnd: 0 })
      .expect(403);
    await request(http)
      .post(`/api/v1/shifts/${shift.id}/close`)
      .set({ ...auth(hkToken), 'If-Match': String(shift.version) })
      .send({ closing_counted_vnd: 0 })
      .expect(403);

    await closeShift(shift.id, 0, shift.version).expect(200); // dọn
  });

  it('STAFF (thu ngân, có payment.reconcile) mở ca → 201 OPEN', async () => {
    const shift = (await openShift(100_000, staffToken).expect(201)).body.data;
    expect(shift.status).toBe('OPEN');
    expect(shift.opening_float_vnd).toBe(100_000);
    await closeShift(shift.id, 100_000, shift.version, staffToken).expect(200); // dọn (STAFF đóng được)
  });

  it('★ STAFF đóng ca tính variance đúng: float 100k + CASH 200k (owner setup) → đếm 300k → variance 0, KHÔNG outbox', async () => {
    const shift = (await openShift(100_000, staffToken).expect(201)).body.data;
    // payCash tạo ad-hoc ADJUSTMENT invoice (cần invoice.create_adhoc — STAFF KHÔNG có) → dùng owner token.
    await payCash(200_000);

    const closed = (await closeShift(shift.id, 300_000, shift.version, staffToken).expect(200)).body.data;
    expect(closed.status).toBe('CLOSED');
    expect(closed.expected_cash_vnd).toBe(300_000); // 100k float + 200k CASH
    expect(closed.variance_vnd).toBe(0);

    const { rows } = await outboxVariance(shift.id);
    expect(rows.length).toBe(0); // variance 0 → KHÔNG emit (ca đã CLOSED nên không kẹt OPEN)
  });

  it('STAFF vẫn KHÔNG đọc được ca (thiếu report.financial): GET /shifts và /shifts/:id → 403 AUTHZ_NO_PERMISSION', async () => {
    const shift = (await openShift(0).expect(201)).body.data; // ca hợp lệ do owner mở để có id đọc thử

    const list = await request(http).get('/api/v1/shifts').set(auth(staffToken)).expect(403);
    expect(list.body.error.code).toBe('AUTHZ_NO_PERMISSION');
    const detail = await request(http).get(`/api/v1/shifts/${shift.id}`).set(auth(staffToken)).expect(403);
    expect(detail.body.error.code).toBe('AUTHZ_NO_PERMISSION');

    await closeShift(shift.id, 0, shift.version).expect(200); // dọn
  });

  it('close thiếu If-Match → 428; sai version → 409 VERSION_CONFLICT', async () => {
    const shift = (await openShift(0).expect(201)).body.data;

    await request(http)
      .post(`/api/v1/shifts/${shift.id}/close`)
      .set(auth())
      .send({ closing_counted_vnd: 0 })
      .expect(428);

    const conflict = await request(http)
      .post(`/api/v1/shifts/${shift.id}/close`)
      .set({ ...auth(), 'If-Match': String(shift.version + 99) })
      .send({ closing_counted_vnd: 0 })
      .expect(409);
    expect(conflict.body.error.code).toBe('VERSION_CONFLICT');

    await closeShift(shift.id, 0, shift.version).expect(200); // đóng đúng version → dọn
  });

  it('close ca đã CLOSED → 422 SHIFT_NOT_OPEN', async () => {
    const shift = (await openShift(0).expect(201)).body.data;
    const closed = (await closeShift(shift.id, 0, shift.version).expect(200)).body.data;

    const res = await request(http)
      .post(`/api/v1/shifts/${shift.id}/close`)
      .set({ ...auth(), 'If-Match': String(closed.version) })
      .send({ closing_counted_vnd: 0 })
      .expect(422);
    expect(res.body.error.code).toBe('SHIFT_NOT_OPEN');
  });

  it('Idempotency-Key trùng khi mở ca → cùng ca, không tạo 2 row', async () => {
    const key = randomUUID();
    const first = (await openShift(0, token, key).expect(201)).body.data;
    const replay = (await openShift(0, token, key).expect(201)).body.data;
    expect(replay.id).toBe(first.id);
    const { rows } = await admin.query(
      `SELECT count(*)::int n FROM cash_shifts WHERE idempotency_key = $1`,
      [key],
    );
    expect(rows[0].n).toBe(1);
    await closeShift(first.id, 0, first.version).expect(200); // dọn
  });

  it('RLS interleaved: tenant A mở ca + tenant B list xen kẽ — list B KHÔNG chứa ca A', async () => {
    const shiftA = (await openShift(0).expect(201)).body.data;

    // tenant B tạo property riêng để list theo cơ sở của mình (mà vẫn ở đường /shifts)
    const listB = await request(http).get('/api/v1/shifts?page=1&page_size=50').set(auth(tokenB)).expect(200);
    const idsB = listB.body.data.map((s: { id: string }) => s.id);
    expect(idsB).not.toContain(shiftA.id);

    // tenant A vẫn thấy ca của mình
    const listA = await request(http).get('/api/v1/shifts?page=1&page_size=50').set(auth()).expect(200);
    expect(listA.body.data.map((s: { id: string }) => s.id)).toContain(shiftA.id);

    await closeShift(shiftA.id, 0, shiftA.version).expect(200); // dọn
  });

  it('GET /shifts/:id → chi tiết ca + danh sách payment CASH thuộc ca', async () => {
    const shift = (await openShift(100_000).expect(201)).body.data;
    const { id: payId } = await payCash(250_000);
    const closed = (await closeShift(shift.id, 350_000, shift.version).expect(200)).body.data;
    expect(closed.expected_cash_vnd).toBe(350_000); // 100k + 250k
    expect(closed.variance_vnd).toBe(0);

    const detail = (await request(http).get(`/api/v1/shifts/${shift.id}`).set(auth()).expect(200)).body.data;
    expect(detail.id).toBe(shift.id);
    expect(detail.cash_payments.map((p: { id: string }) => p.id)).toContain(payId);
    expect(detail.cash_payments.every((p: { method: string }) => p.method === 'CASH')).toBe(true);
  });
});
