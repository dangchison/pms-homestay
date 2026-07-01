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
 * ★ Acceptance TASK 9.5 (docs/16 #11 — Wave 1 chống thất thoát tiền mặt): báo cáo
 * anti-fraud. GET /reports/anti-fraud phát hiện 4 dấu hiệu gian lận tiền mặt bounded
 * theo [from,to] + property (server-side), KHÔNG lộ PII khách (chỉ booking_code +
 * staff id/name). RBAC report.financial + authorizeOnProperty; RLS chặn cross-tenant.
 *
 * Seed: property/room/rate-plan/booking + CASH payment qua ad-hoc ADJUSTMENT invoice
 * gắn booking (giống shifts.e2e). Backdate timestamp (received_at/refunded_at/
 * voided_at/paid_at/booking_status_history.created_at/audit_logs.created_at) qua admin
 * SQL để đặt sự kiện vào kỳ mong muốn — mỗi pattern dùng CỬA SỔ ngày riêng để không
 * lẫn finding chéo.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const slugA = `af-a-${RUN}`;
const slugB = `af-b-${RUN}`;
const ownerA = `owner-a-${RUN}@e2e.test`;
const ownerB = `owner-b-${RUN}@e2e.test`;
const hkEmail = `hk-${RUN}@e2e.test`;
const staffXEmail = `staffx-${RUN}@e2e.test`;
const staffYEmail = `staffy-${RUN}@e2e.test`;

// Cửa sổ ngày riêng cho từng pattern (không chồng lấn → không lẫn finding).
const W_P1 = { from: '2026-02-01', to: '2026-02-28' };
const W_P2 = { from: '2026-03-01', to: '2026-03-31' };
const W_P3 = { from: '2026-04-01', to: '2026-04-30' };
const W_P4 = { from: '2026-05-01', to: '2026-05-31' };
const W_CLEAN = { from: '2026-06-01', to: '2026-06-30' };
const W_OUT = { from: '2020-01-01', to: '2020-12-31' };

describe('Anti-fraud report (task 9.5, docs/16 #11)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string; // owner tenant A (report.financial + full quyền)
  let hkToken: string; // HOUSEKEEPER tenant A (thiếu report.financial)
  let tokenB: string; // owner tenant B (cross-tenant)
  let tenantId: string;
  let propertyId: string; // property A chính (chứa các pattern)
  let propertyB2: string; // property khác cùng tenant A (test không lẫn)
  let resId: string;
  let staffXId: string;
  let staffYId: string;

  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

  /** Tạo booking neo trên 1 property (để gắn invoice/payment) — trả booking + code. */
  const makeBooking = async (
    propId: string,
    res: string,
    ci: string,
    co: string,
  ): Promise<{ id: string; code: string }> => {
    const quoteId = (
      await request(http)
        .post('/api/v1/pricing/quote')
        .set(auth())
        .send({ resource_id: res, mode: 'DAILY', check_in: ci, check_out: co })
        .expect(200)
    ).body.data.quote_id;
    const b = (
      await request(http)
        .post('/api/v1/bookings')
        .set({ ...auth(), 'Idempotency-Key': randomUUID() })
        .send({ resource_id: res, quote_id: quoteId, mode: 'DAILY', check_in: ci, check_out: co })
        .expect(201)
    ).body.data;
    return { id: b.id as string, code: b.booking_code as string };
  };

  /** Ad-hoc ADJUSTMENT invoice GẮN booking (issue ngay) — payment gắn property. */
  const adhocInvoice = async (bookingId: string, unitPrice: number): Promise<string> => {
    const res = await request(http)
      .post('/api/v1/invoices')
      .set(auth())
      .send({
        booking_id: bookingId,
        kind: 'ADJUSTMENT',
        issue: true,
        items: [{ item_type: 'SURCHARGE', description: 'Thu', quantity: 1, unit_price_vnd: unitPrice }],
      })
      .expect(201);
    return res.body.data.id as string;
  };

  /** Thu CASH đúng số vào 1 invoice ad-hoc mới của booking → payment CASH SUCCEEDED. */
  const payCash = async (bookingId: string, amount: number): Promise<{ id: string; invoiceId: string }> => {
    const invoiceId = await adhocInvoice(bookingId, amount);
    const res = await request(http)
      .post('/api/v1/payments')
      .set({ ...auth(), 'Idempotency-Key': randomUUID() })
      .send({ invoice_id: invoiceId, amount_vnd: amount, method: 'CASH' })
      .expect(201);
    return { id: res.body.data.id as string, invoiceId };
  };

  const getReport = (q: { property_id?: string; from?: string; to?: string }, t = token) => {
    const params = new URLSearchParams();
    if (q.property_id) params.set('property_id', q.property_id);
    if (q.from) params.set('from', q.from);
    if (q.to) params.set('to', q.to);
    return request(http).get(`/api/v1/reports/anti-fraud?${params.toString()}`).set(auth(t));
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

    const register = (slug: string, email: string, name: string) =>
      request(http)
        .post('/api/v1/auth/register')
        .send({ tenant_slug: slug, tenant_display_name: name, email, password: PASSWORD, full_name: 'Owner' })
        .expect(201);
    await register(slugA, ownerA, 'AF A');
    await register(slugB, ownerB, 'AF B');

    const login = (slug: string, email: string) =>
      request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', slug).send({ email, password: PASSWORD }).expect(200);
    token = (await login(slugA, ownerA)).body.data.access_token;
    tokenB = (await login(slugB, ownerB)).body.data.access_token;
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [slugA])).rows[0].id as string;
    // Nâng gói tenant A → ENTERPRISE (FREE chỉ cho 1 property/2 user) để tạo property phụ +
    // seed nhiều nhân viên phục vụ test isolation/attribution. Chỉ ảnh hưởng plan-limit.
    await admin.query(
      `UPDATE tenants SET subscription_plan_id = (SELECT id FROM subscription_plans WHERE code = 'ENTERPRISE') WHERE id = $1`,
      [tenantId],
    );

    const makeProperty = async (name: string): Promise<{ propertyId: string; resId: string }> => {
      const pid = (
        await request(http)
          .post('/api/v1/properties')
          .set(auth())
          .send({ name, property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' })
          .expect(201)
      ).body.data.id;
      const room = (
        await request(http).post('/api/v1/rooms').set(auth()).send({ property_id: pid, room_number: '101' }).expect(201)
      ).body.data.id;
      const rid = (
        await request(http).get(`/api/v1/bookable-resources?property_id=${pid}`).set(auth()).expect(200)
      ).body.data.find((r: { room_ids: string[] }) => r.room_ids.includes(room)).id;
      await request(http)
        .post('/api/v1/rate-plans')
        .set(auth())
        .send({
          property_id: pid,
          name: 'Cọc 30%',
          mode: 'DAILY',
          base_price_vnd: 500_000,
          effective_from: '2026-01-01',
          deposit_type: 'PERCENT',
          deposit_value: 3000,
          resource_ids: [rid],
        })
        .expect(201);
      return { propertyId: pid, resId: rid };
    };
    ({ propertyId, resId } = await makeProperty('P-main'));
    propertyB2 = (await makeProperty('P-other')).propertyId;

    // HOUSEKEEPER tenant A (thiếu report.financial) cho test 403.
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const mkUser = async (email: string, role: string, name: string): Promise<string> => {
      const u = await admin.query(
        `INSERT INTO users (tenant_id, email, password_hash, full_name, default_role) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [tenantId, email, hash, name, role],
      );
      const uid = u.rows[0].id as string;
      await admin.query(
        `INSERT INTO user_property_roles (tenant_id, user_id, property_id, role) VALUES ($1,$2,$3,$4)`,
        [tenantId, uid, propertyId, role],
      );
      return uid;
    };
    await mkUser(hkEmail, 'HOUSEKEEPER', 'Buồng phòng');
    // staffX/staffY = nhân viên (received_by cho refund) — full_name để assert staff_name.
    staffXId = await mkUser(staffXEmail, 'STAFF', 'Nguyễn Văn X');
    staffYId = await mkUser(staffYEmail, 'STAFF', 'Trần Thị Y');
    hkToken = (await login(slugA, hkEmail)).body.data.access_token;
  });

  afterAll(async () => {
    // Đóng app TRƯỚC khi dọn DB → dừng outbox dispatcher của tiến trình test.
    await app?.close();
    if (admin) {
      for (const slug of [slugA, slugB]) {
        const tid = `(SELECT id FROM tenants WHERE slug = '${slug}')`;
        // outbox_events XOÁ TRƯỚC → cắt nguồn: dev API (:3001, scheduler bật) claim outbox
        // cross-tenant từ booking.created rồi sinh notifications (FK → users) — gotcha
        // dev-server-vs-outbox (giống night-audit). Sau khi outbox rỗng, dispatcher không
        // còn gì để claim; notifications xoá lại lần cuối ngay trước users để chống đua.
        await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM notifications WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM payment_attempts WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM payments WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM invoice_items WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM invoices WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM room_occupancy WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM booking_status_history WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM audit_logs WHERE tenant_id IN ${tid}`);
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
        // Sweep cuối notifications (dev dispatcher có thể chèn xen giữa các DELETE trên).
        await admin.query(`DELETE FROM notifications WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM tenants WHERE slug = $1`, [slug]);
      }
      await admin.end();
    }
  });

  // ── Pattern 1: CANCEL_AFTER_CASH ─────────────────────────────────────────────
  it('★ P1 CANCEL_AFTER_CASH: thu CASH rồi hủy → HIGH, booking_code + net amount đúng', async () => {
    const b = await makeBooking(propertyId, resId, '2027-02-01T07:00:00Z', '2027-02-03T05:00:00Z');
    const { id: payId, invoiceId } = await payCash(b.id, 800_000);
    // Backdate received_at vào kỳ P1 và đặt trạng thái CANCELLED + history sau received_at.
    await admin.query(`UPDATE payments SET received_at = '2026-02-10T03:00:00Z' WHERE id = $1`, [payId]);
    await admin.query(`UPDATE bookings SET status = 'CANCELLED' WHERE id = $1`, [b.id]);
    await admin.query(
      `INSERT INTO booking_status_history (tenant_id, booking_id, to_status, created_at)
       VALUES ($1, $2, 'CANCELLED', '2026-02-11T03:00:00Z')`,
      [tenantId, b.id],
    );

    const res = await getReport({ property_id: propertyId, ...W_P1 }).expect(200);
    const data = res.body.data;
    const f = data.findings.find(
      (x: { type: string; booking_code: string }) => x.type === 'CANCEL_AFTER_CASH' && x.booking_code === b.code,
    );
    expect(f).toBeDefined();
    expect(f.severity).toBe('HIGH');
    expect(f.amount_vnd).toBe(800_000);
    expect(f.entity_type).toBe('booking');
    expect(f.entity_id).toBe(b.id);
    expect(f.occurred_at).toBe(new Date('2026-02-11T03:00:00Z').toISOString());
    // Không lộ PII khách trong toàn bộ response.
    expect(JSON.stringify(res.body)).not.toContain('guest_id');
    // Dùng invoiceId để tránh biến thừa (đã tạo qua ad-hoc).
    expect(typeof invoiceId).toBe('string');
  });

  it('★ P1 no false-positive: booking CANCELLED nhưng KHÔNG có CASH → không sinh finding', async () => {
    const b = await makeBooking(propertyId, resId, '2027-02-05T07:00:00Z', '2027-02-07T05:00:00Z');
    await admin.query(`UPDATE bookings SET status = 'CANCELLED' WHERE id = $1`, [b.id]);
    await admin.query(
      `INSERT INTO booking_status_history (tenant_id, booking_id, to_status, created_at)
       VALUES ($1, $2, 'CANCELLED', '2026-02-12T03:00:00Z')`,
      [tenantId, b.id],
    );
    const res = await getReport({ property_id: propertyId, ...W_P1 }).expect(200);
    const f = res.body.data.findings.find(
      (x: { type: string; booking_code: string }) => x.type === 'CANCEL_AFTER_CASH' && x.booking_code === b.code,
    );
    expect(f).toBeUndefined();
  });

  // ── Pattern 2: REFUND_ANOMALY_BY_STAFF ───────────────────────────────────────
  it('★ P2 REFUND_ANOMALY_BY_STAFF: staffX vượt ngưỡng tuyệt đối → HIGH, staff_id+tổng+name đúng', async () => {
    // 3 refund của staffX: 1_000_000 + 800_000 + 700_000 = 2_500_000 (>2tr, ≥3 lần) → HIGH.
    // Booking neo dùng NGÀY khác nhau (không chồng resource → tránh 409); refund backdate SQL.
    const amounts = [1_000_000, 800_000, 700_000];
    const payIds: string[] = [];
    for (let i = 0; i < amounts.length; i++) {
      const day = 1 + i * 4; // 01, 05, 09
      const dd = String(day).padStart(2, '0');
      const dd2 = String(day + 2).padStart(2, '0');
      const b = await makeBooking(propertyId, resId, `2027-03-${dd}T07:00:00Z`, `2027-03-${dd2}T05:00:00Z`);
      const { id } = await payCash(b.id, amounts[i] as number);
      payIds.push(id);
    }
    // Đặt received_by = staffX, refunded toàn phần, refunded_at trong kỳ P2.
    for (let i = 0; i < payIds.length; i++) {
      await admin.query(
        `UPDATE payments SET received_by = $1, refunded_amount_vnd = amount_vnd, status = 'REFUNDED',
           refunded_at = $2 WHERE id = $3`,
        [staffXId, `2026-03-${10 + i}T03:00:00Z`, payIds[i]],
      );
    }
    // staffY 1 refund nhỏ 100k → KHÔNG bị cờ (dưới ngưỡng); giữ 2 staff cho z-score có nghĩa.
    const bY = await makeBooking(propertyId, resId, '2027-03-20T07:00:00Z', '2027-03-22T05:00:00Z');
    const { id: payY } = await payCash(bY.id, 100_000);
    await admin.query(
      `UPDATE payments SET received_by = $1, refunded_amount_vnd = amount_vnd, status = 'REFUNDED',
         refunded_at = '2026-03-20T03:00:00Z' WHERE id = $2`,
      [staffYId, payY],
    );

    const res = await getReport({ property_id: propertyId, ...W_P2 }).expect(200);
    const findings = res.body.data.findings.filter(
      (x: { type: string }) => x.type === 'REFUND_ANOMALY_BY_STAFF',
    );
    const fx = findings.find((x: { staff_id: string }) => x.staff_id === staffXId);
    expect(fx).toBeDefined();
    expect(fx.severity).toBe('HIGH');
    expect(fx.amount_vnd).toBe(2_500_000);
    expect(fx.staff_name).toBe('Nguyễn Văn X');
    expect(fx.entity_type).toBe('payment');
    // occurred_at = refund gần nhất (2026-03-12).
    expect(fx.occurred_at).toBe(new Date('2026-03-12T03:00:00Z').toISOString());
    // staffY dưới ngưỡng → KHÔNG cờ.
    const fy = findings.find((x: { staff_id: string }) => x.staff_id === staffYId);
    expect(fy).toBeUndefined();
  });

  // ── Pattern 3: NO_SHOW_DEPOSIT_REMOVED ───────────────────────────────────────
  it('★ P3 NO_SHOW_DEPOSIT_REMOVED: NO_SHOW + cọc từng PAID bị VOID → HIGH, entity=DEPOSIT invoice', async () => {
    const b = await makeBooking(propertyId, resId, '2027-04-01T07:00:00Z', '2027-04-03T05:00:00Z');
    // Cọc DEPOSIT từng PAID 300k rồi bị VOID (rút cọc).
    const depId = (
      await admin.query(
        `INSERT INTO invoices (tenant_id, booking_id, kind, invoice_number, status, total_vnd, paid_vnd, paid_at, voided_at)
         VALUES ($1,$2,'DEPOSIT',$3,'VOID',300000,0,'2026-04-05T03:00:00Z','2026-04-15T03:00:00Z') RETURNING id`,
        [tenantId, b.id, `DEP-${RUN}-1`],
      )
    ).rows[0].id as string;
    // CASH payment DEPOSIT đã thu 300k (để suy "cọc từng thu").
    await admin.query(
      `INSERT INTO payments (tenant_id, invoice_id, amount_vnd, method, status, received_at)
       VALUES ($1,$2,300000,'CASH','SUCCEEDED','2026-04-05T03:00:00Z')`,
      [tenantId, depId],
    );
    // Booking NO_SHOW + history NO_SHOW trong kỳ.
    await admin.query(`UPDATE bookings SET status = 'NO_SHOW' WHERE id = $1`, [b.id]);
    await admin.query(
      `INSERT INTO booking_status_history (tenant_id, booking_id, to_status, created_at)
       VALUES ($1,$2,'NO_SHOW','2026-04-10T03:00:00Z')`,
      [tenantId, b.id],
    );

    const res = await getReport({ property_id: propertyId, ...W_P3 }).expect(200);
    const f = res.body.data.findings.find(
      (x: { type: string; booking_code: string }) => x.type === 'NO_SHOW_DEPOSIT_REMOVED' && x.booking_code === b.code,
    );
    expect(f).toBeDefined();
    expect(f.severity).toBe('HIGH');
    expect(f.amount_vnd).toBe(300_000);
    expect(f.entity_type).toBe('invoice');
    expect(f.entity_id).toBe(depId);
    expect(f.occurred_at).toBe(new Date('2026-04-15T03:00:00Z').toISOString());
  });

  it('★ P3 forfeit hợp lệ: NO_SHOW + DEPOSIT vẫn PAID + ADJUSTMENT DEPOSIT_APPLIED → KHÔNG cờ', async () => {
    const b = await makeBooking(propertyId, resId, '2027-04-05T07:00:00Z', '2027-04-07T05:00:00Z');
    const depId = (
      await admin.query(
        `INSERT INTO invoices (tenant_id, booking_id, kind, invoice_number, status, total_vnd, paid_vnd, paid_at)
         VALUES ($1,$2,'DEPOSIT',$3,'PAID',300000,300000,'2026-04-06T03:00:00Z') RETURNING id`,
        [tenantId, b.id, `DEP-${RUN}-2`],
      )
    ).rows[0].id as string;
    await admin.query(
      `INSERT INTO payments (tenant_id, invoice_id, amount_vnd, method, status, received_at)
       VALUES ($1,$2,300000,'CASH','SUCCEEDED','2026-04-06T03:00:00Z')`,
      [tenantId, depId],
    );
    // ADJUSTMENT forfeit hợp lệ: SURCHARGE + DEPOSIT_APPLIED ref → DEPOSIT (cọc GIỮ).
    const adjId = (
      await admin.query(
        `INSERT INTO invoices (tenant_id, booking_id, kind, invoice_number, status, total_vnd)
         VALUES ($1,$2,'ADJUSTMENT',$3,'ISSUED',0) RETURNING id`,
        [tenantId, b.id, `ADJ-${RUN}-2`],
      )
    ).rows[0].id as string;
    await admin.query(
      `INSERT INTO invoice_items (tenant_id, invoice_id, item_type, description, quantity, unit_price_vnd, amount_vnd, ref_invoice_id)
       VALUES ($1,$2,'DEPOSIT_APPLIED','forfeit',1,-300000,-300000,$3)`,
      [tenantId, adjId, depId],
    );
    await admin.query(`UPDATE bookings SET status = 'NO_SHOW' WHERE id = $1`, [b.id]);
    await admin.query(
      `INSERT INTO booking_status_history (tenant_id, booking_id, to_status, created_at)
       VALUES ($1,$2,'NO_SHOW','2026-04-10T03:00:00Z')`,
      [tenantId, b.id],
    );

    const res = await getReport({ property_id: propertyId, ...W_P3 }).expect(200);
    const f = res.body.data.findings.find(
      (x: { type: string; booking_code: string }) => x.type === 'NO_SHOW_DEPOSIT_REMOVED' && x.booking_code === b.code,
    );
    expect(f).toBeUndefined(); // forfeit hợp lệ, tiền vẫn giữ → không gian lận
  });

  // ── Pattern 4: PRICE_EDIT_AFTER_CHECKIN ──────────────────────────────────────
  it('★ P4 PRICE_EDIT_AFTER_CHECKIN: audit UPDATE booking sau check-in → MEDIUM, staff+entity đúng', async () => {
    const b = await makeBooking(propertyId, resId, '2027-05-01T07:00:00Z', '2027-05-03T05:00:00Z');
    // Đặt actual_check_in vào kỳ P4.
    await admin.query(`UPDATE bookings SET status = 'CHECKED_IN', actual_check_in = '2026-05-05T03:00:00Z' WHERE id = $1`, [
      b.id,
    ]);
    // audit UPDATE (plural 'bookings') SAU check-in, có delta total_amount_vnd.
    await admin.query(
      `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, before_data, after_data, created_at)
       VALUES ($1,$2,'UPDATE','bookings',$3,$4,$5,'2026-05-10T03:00:00Z')`,
      [
        tenantId,
        staffXId,
        b.id,
        JSON.stringify({ total_amount_vnd: 1_000_000 }),
        JSON.stringify({ total_amount_vnd: 600_000 }),
      ],
    );

    const res = await getReport({ property_id: propertyId, ...W_P4 }).expect(200);
    const f = res.body.data.findings.find(
      (x: { type: string; booking_code: string }) => x.type === 'PRICE_EDIT_AFTER_CHECKIN' && x.booking_code === b.code,
    );
    expect(f).toBeDefined();
    expect(f.severity).toBe('MEDIUM');
    expect(f.entity_type).toBe('booking'); // 'bookings' → 'booking'
    expect(f.entity_id).toBe(b.id);
    expect(f.staff_id).toBe(staffXId);
    expect(f.staff_name).toBe('Nguyễn Văn X');
    expect(f.amount_vnd).toBe(400_000); // |600k − 1tr|
    expect(f.occurred_at).toBe(new Date('2026-05-10T03:00:00Z').toISOString());
  });

  it('★ P4 no false-positive: audit UPDATE TRƯỚC check-in → KHÔNG cờ', async () => {
    const b = await makeBooking(propertyId, resId, '2027-05-05T07:00:00Z', '2027-05-07T05:00:00Z');
    await admin.query(`UPDATE bookings SET status = 'CHECKED_IN', actual_check_in = '2026-05-20T03:00:00Z' WHERE id = $1`, [
      b.id,
    ]);
    // audit TRƯỚC check-in (2026-05-10 < 2026-05-20).
    await admin.query(
      `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, after_data, created_at)
       VALUES ($1,$2,'UPDATE','bookings',$3,$4,'2026-05-10T03:00:00Z')`,
      [tenantId, staffXId, b.id, JSON.stringify({ total_amount_vnd: 600_000 })],
    );
    const res = await getReport({ property_id: propertyId, ...W_P4 }).expect(200);
    const f = res.body.data.findings.find(
      (x: { type: string; booking_code: string }) => x.type === 'PRICE_EDIT_AFTER_CHECKIN' && x.booking_code === b.code,
    );
    expect(f).toBeUndefined();
  });

  // ── Scope: thời gian + property + tenancy + RBAC ─────────────────────────────
  it('kỳ NGOÀI phạm vi (2020) → findings rỗng, summary.total = 0', async () => {
    const res = await getReport({ property_id: propertyId, ...W_OUT }).expect(200);
    expect(res.body.data.findings).toEqual([]);
    expect(res.body.data.summary.total).toBe(0);
  });

  it('property KHÁC cùng tenant: seed gian lận ở propertyB2 rồi query propertyId → KHÔNG lẫn', async () => {
    // Seed 1 CANCEL_AFTER_CASH ở propertyB2 trong kỳ P1.
    const resB2 = (
      await request(http).get(`/api/v1/bookable-resources?property_id=${propertyB2}`).set(auth()).expect(200)
    ).body.data[0].id;
    const b = await makeBooking(propertyB2, resB2, '2027-02-20T07:00:00Z', '2027-02-22T05:00:00Z');
    const { id: payId } = await payCash(b.id, 999_000);
    await admin.query(`UPDATE payments SET received_at = '2026-02-15T03:00:00Z' WHERE id = $1`, [payId]);
    await admin.query(`UPDATE bookings SET status = 'CANCELLED' WHERE id = $1`, [b.id]);
    await admin.query(
      `INSERT INTO booking_status_history (tenant_id, booking_id, to_status, created_at)
       VALUES ($1,$2,'CANCELLED','2026-02-16T03:00:00Z')`,
      [tenantId, b.id],
    );

    // Query propertyId (main) — KHÔNG được chứa finding của propertyB2.
    const res = await getReport({ property_id: propertyId, ...W_P1 }).expect(200);
    const leaked = res.body.data.findings.find(
      (x: { booking_code: string }) => x.booking_code === b.code,
    );
    expect(leaked).toBeUndefined();

    // Query propertyB2 → CÓ finding của nó.
    const resB = await getReport({ property_id: propertyB2, ...W_P1 }).expect(200);
    const own = resB.body.data.findings.find((x: { booking_code: string }) => x.booking_code === b.code);
    expect(own).toBeDefined();
    expect(own.amount_vnd).toBe(999_000);
  });

  it('cross-tenant: tenant B query property của tenant A → 404 PROPERTY_NOT_FOUND', async () => {
    const res = await getReport({ property_id: propertyId, ...W_P1 }, tokenB).expect(404);
    expect(res.body.error.code).toBe('PROPERTY_NOT_FOUND');
  });

  it('HOUSEKEEPER (thiếu report.financial) → 403', async () => {
    await getReport({ property_id: propertyId, ...W_P1 }, hkToken).expect(403);
  });

  it('validate query: thiếu property_id → 400; from > to → 400 (ValidationException toàn cục)', async () => {
    // Repo trả 400 cho lỗi validate query (ValidationException, docs/14: validation=400,
    // business=422/409). AntiFraudQuerySchema chặn thiếu property_id + refine from<=to.
    await getReport({ from: W_P1.from, to: W_P1.to }).expect(400);
    await getReport({ property_id: propertyId, from: '2026-03-01', to: '2026-02-01' }).expect(400);
  });

  it('booking sạch (thu CASH, CHECKED_OUT bình thường) → không false-positive', async () => {
    const b = await makeBooking(propertyId, resId, '2027-06-01T07:00:00Z', '2027-06-03T05:00:00Z');
    const { id: payId } = await payCash(b.id, 500_000);
    await admin.query(`UPDATE payments SET received_at = '2026-06-10T03:00:00Z' WHERE id = $1`, [payId]);
    // CHECKED_OUT bình thường — không hủy, không refund, không sửa giá sau check-in.
    await admin.query(`UPDATE bookings SET status = 'CHECKED_OUT' WHERE id = $1`, [b.id]);
    const res = await getReport({ property_id: propertyId, ...W_CLEAN }).expect(200);
    const own = res.body.data.findings.filter((x: { booking_code: string }) => x.booking_code === b.code);
    expect(own).toEqual([]);
  });

  it('KHÔNG lộ PII khách + KHÔNG emit outbox mới khi chạy report', async () => {
    const before = (
      await admin.query(`SELECT count(*)::int n FROM outbox_events WHERE tenant_id = $1`, [tenantId])
    ).rows[0].n as number;

    // Query toàn kỳ (2026) → gom nhiều finding.
    const res = await getReport({ property_id: propertyId, from: '2026-01-01', to: '2026-12-31' }).expect(200);
    expect(res.body.data.summary.total).toBeGreaterThan(0);

    const after = (
      await admin.query(`SELECT count(*)::int n FROM outbox_events WHERE tenant_id = $1`, [tenantId])
    ).rows[0].n as number;
    expect(after).toBe(before); // report chỉ đọc → KHÔNG outbox

    // Không lộ PII khách: guest_id + email/phone/tên khách không có trong response.
    const s = JSON.stringify(res.body);
    expect(s).not.toContain('guest_id');
    expect(s).not.toContain('@e2e.test'); // email khách/không rò rỉ
    expect(s).not.toContain('cancellation_reason');
    expect(s).not.toContain('"notes"');
  });
});
