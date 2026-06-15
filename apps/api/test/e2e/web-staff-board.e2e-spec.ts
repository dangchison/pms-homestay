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
 * ★ Acceptance task 6.6 (spec ui/02 #T2/#T7) — endpoint web-staff PWA:
 *  - GET /bookings/today: phân nhóm đến/đi/đang ở theo NGÀY giờ địa phương cơ sở,
 *    kèm balance_due_vnd / deposit_due_vnd (gate check-in + hiện số dư).
 *  - GET /rooms/board: grid phòng + housekeeping + cờ "đang có khách" (CHECKED_IN
 *    phủ now()).
 *  - PATCH /rooms/:id/housekeeping: đổi nhanh trạng thái; HOUSEKEEPER chỉ CLEANING→CLEAN.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `staff-${RUN}`;
const ownerEmail = `owner-${RUN}@e2e.test`;
const hkEmail = `hk-${RUN}@e2e.test`;
const BOARD_DATE = '2026-08-15';

describe('Web-staff board — GET /bookings/today + /rooms/board + PATCH housekeeping (task 6.6)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let hkToken: string;
  let tenantId: string;
  let propertyId: string;
  let room101: string;
  let room102: string;
  let room103: string;
  let resA: string;
  let resB: string;
  let resC: string;
  let guestId: string;
  let bkArrival: string;
  let bkDepart: string;
  let bkInhouse: string;

  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

  const quote = async (resourceId: string, checkIn: string, checkOut: string): Promise<string> =>
    (
      await request(http)
        .post('/api/v1/pricing/quote')
        .set(auth())
        .send({ resource_id: resourceId, mode: 'DAILY', check_in: checkIn, check_out: checkOut })
        .expect(200)
    ).body.data.quote_id;

  const book = async (resourceId: string, ci: string, co: string, guest?: string): Promise<string> => {
    const q = await quote(resourceId, ci, co);
    return (
      await request(http)
        .post('/api/v1/bookings')
        .set({ ...auth(), 'Idempotency-Key': randomUUID() })
        .send({ resource_id: resourceId, quote_id: q, mode: 'DAILY', check_in: ci, check_out: co, ...(guest ? { guest_id: guest } : {}) })
        .expect(201)
    ).body.data.id;
  };

  const today = (date?: string, prop = propertyId, t = token) =>
    request(http)
      .get(`/api/v1/bookings/today?property_id=${prop}${date ? `&date=${date}` : ''}`)
      .set(auth(t));

  const board = (prop = propertyId, t = token) =>
    request(http).get(`/api/v1/rooms/board?property_id=${prop}`).set(auth(t));

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
      .send({ tenant_slug: tenantSlug, tenant_display_name: 'STAFF E2E', email: ownerEmail, password: PASSWORD, full_name: 'Owner' })
      .expect(201);
    token = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: ownerEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id;

    propertyId = (
      await request(http).post('/api/v1/properties').set(auth()).send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' }).expect(201)
    ).body.data.id;
    const mkRoom = async (n: string) =>
      (await request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: n }).expect(201)).body.data.id;
    room101 = await mkRoom('101');
    room102 = await mkRoom('102');
    room103 = await mkRoom('103');
    const resources = (
      await request(http).get(`/api/v1/bookable-resources?property_id=${propertyId}`).set(auth()).expect(200)
    ).body.data as { id: string; room_ids: string[] }[];
    resA = resources.find((r) => r.room_ids.includes(room101))!.id;
    resB = resources.find((r) => r.room_ids.includes(room102))!.id;
    resC = resources.find((r) => r.room_ids.includes(room103))!.id;

    await request(http)
      .post('/api/v1/rate-plans')
      .set(auth())
      .send({ property_id: propertyId, name: 'DAILY', mode: 'DAILY', base_price_vnd: 500_000, effective_from: '2026-01-01', resource_ids: [resA, resB, resC] })
      .expect(201);

    guestId = (
      await request(http).post('/api/v1/guests').set(auth()).send({ full_name: 'Nguyễn Văn A', phone: '0900000001' }).expect(201)
    ).body.data.id;

    // Housekeeper (chỉ room.housekeeping.change) — seed trực tiếp + login.
    const hkHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const hk = await admin.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, default_role) VALUES ($1,$2,$3,'HK','HOUSEKEEPER') RETURNING id`,
      [tenantId, hkEmail, hkHash],
    );
    await admin.query(`INSERT INTO user_property_roles (tenant_id, user_id, property_id, role) VALUES ($1,$2,$3,'HOUSEKEEPER')`, [tenantId, hk.rows[0].id, propertyId]);
    hkToken = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: hkEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;

    // 3 booking trên 3 resource khác nhau (tránh đụng occupancy), date cố định quanh BOARD_DATE.
    bkArrival = await book(resA, '2026-08-15T06:00:00.000Z', '2026-08-17T05:00:00.000Z'); // PENDING, đến hôm 15
    bkDepart = await book(resB, '2026-08-13T06:00:00.000Z', '2026-08-15T05:00:00.000Z'); // → CHECKED_IN, đi hôm 15
    bkInhouse = await book(resC, '2026-08-14T06:00:00.000Z', '2026-08-18T05:00:00.000Z', guestId); // → CHECKED_IN, ở qua 15

    // Phụ thu 200k trên bkDepart (ISSUED) → balance_due_vnd.
    await request(http)
      .post('/api/v1/invoices')
      .set(auth())
      .send({ booking_id: bkDepart, kind: 'ADJUSTMENT', issue: true, items: [{ item_type: 'SURCHARGE', description: 'Phụ thu minibar', quantity: 1, unit_price_vnd: 200_000 }] })
      .expect(201);

    // Đưa 2 booking vào trạng thái CHECKED_IN (web-staff today board đọc status trực tiếp).
    await admin.query(`UPDATE bookings SET status='CHECKED_IN', actual_check_in = now() WHERE id IN ($1,$2)`, [bkDepart, bkInhouse]);
    // bkInhouse "đang có khách bây giờ" cho room board → occupancy phủ now().
    await admin.query(
      `UPDATE room_occupancy SET period = tstzrange(now() - interval '1 hour', now() + interval '2 days') WHERE booking_id = $1`,
      [bkInhouse],
    );
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM invoice_items WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM invoices WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM room_occupancy WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM booking_status_history WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM quotes WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM bookings WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM rate_plan_resources WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM rate_plans WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM resource_members WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM bookable_resources WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM rooms WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM guests WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM idempotency_keys WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM document_counters WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await app?.close();
  });

  const ids = (arr: { id: string }[]) => arr.map((x) => x.id);

  it('today (date cố định): đến/đi/đang ở vào đúng nhóm', async () => {
    const res = await today(BOARD_DATE).expect(200);
    const d = res.body.data as { date: string; arrivals: { id: string }[]; departures: { id: string }[]; in_house: { id: string }[] };
    expect(d.date).toBe(BOARD_DATE);
    expect(ids(d.arrivals)).toContain(bkArrival);
    expect(ids(d.departures)).toContain(bkDepart);
    expect(ids(d.in_house)).toContain(bkInhouse);
    // không lẫn nhóm
    expect(ids(d.arrivals)).not.toContain(bkDepart);
    expect(ids(d.in_house)).not.toContain(bkDepart);
    expect(ids(d.departures)).not.toContain(bkInhouse);
  });

  it('today: balance_due_vnd phản ánh hoá đơn ISSUED; deposit_due_vnd=0 (không phải cọc)', async () => {
    const res = await today(BOARD_DATE).expect(200);
    const dep = (res.body.data.departures as { id: string; balance_due_vnd: number; deposit_due_vnd: number; guest_name: string | null }[]).find((x) => x.id === bkDepart)!;
    expect(dep.balance_due_vnd).toBe(200_000);
    expect(dep.deposit_due_vnd).toBe(0);
    const inh = (res.body.data.in_house as { id: string; guest_name: string | null }[]).find((x) => x.id === bkInhouse)!;
    expect(inh.guest_name).toBe('Nguyễn Văn A');
  });

  it('today (mặc định = hôm nay): không lượt đến hôm nay; CHECKED_IN tương lai vào "đang ở"', async () => {
    const res = await today().expect(200); // now = 2026-06-15 (context), booking ở tháng 8
    const d = res.body.data as { arrivals: { id: string }[]; in_house: { id: string }[] };
    expect(ids(d.arrivals)).not.toContain(bkArrival); // check_in 15/08 ≠ hôm nay
    expect(ids(d.in_house)).toEqual(expect.arrayContaining([bkDepart, bkInhouse]));
  });

  it('rooms board: phòng có khách CHECKED_IN (phủ now()) → is_occupied_now + tên khách', async () => {
    const res = await board().expect(200);
    const rooms = res.body.data.rooms as { id: string; room_number: string; housekeeping_status: string; is_occupied_now: boolean; current_guest_name: string | null }[];
    expect(rooms.length).toBe(3);
    const r103 = rooms.find((r) => r.id === room103)!;
    expect(r103.is_occupied_now).toBe(true);
    expect(r103.current_guest_name).toBe('Nguyễn Văn A');
    const r101 = rooms.find((r) => r.id === room101)!;
    expect(r101.is_occupied_now).toBe(false);
    expect(r101.housekeeping_status).toBe('CLEAN'); // default
  });

  it('PATCH housekeeping (OWNER): CLEAN → DIRTY ok, board phản ánh', async () => {
    const res = await request(http).patch(`/api/v1/rooms/${room102}/housekeeping`).set(auth()).send({ housekeeping_status: 'DIRTY' }).expect(200);
    expect(res.body.data.housekeeping_status).toBe('DIRTY');
    const after = await board().expect(200);
    expect((after.body.data.rooms as { id: string; housekeeping_status: string }[]).find((r) => r.id === room102)!.housekeeping_status).toBe('DIRTY');
  });

  it('PATCH housekeeping (HOUSEKEEPER): CLEAN→DIRTY bị chặn 403; CLEANING→CLEAN cho phép', async () => {
    // HOUSEKEEPER không được chuyển tuỳ ý
    const forbidden = await request(http).patch(`/api/v1/rooms/${room101}/housekeeping`).set(auth(hkToken)).send({ housekeeping_status: 'DIRTY' }).expect(403);
    expect(forbidden.body.error.code).toBe('HOUSEKEEPING_TRANSITION_FORBIDDEN');
    // OWNER đưa về CLEANING, rồi HOUSEKEEPER nghiệm thu CLEANING→CLEAN
    await request(http).patch(`/api/v1/rooms/${room101}/housekeeping`).set(auth()).send({ housekeeping_status: 'CLEANING' }).expect(200);
    const ok = await request(http).patch(`/api/v1/rooms/${room101}/housekeeping`).set(auth(hkToken)).send({ housekeeping_status: 'CLEAN' }).expect(200);
    expect(ok.body.data.housekeeping_status).toBe('CLEAN');
  });

  it('PATCH housekeeping: trạng thái không hợp lệ → 400', async () => {
    await request(http).patch(`/api/v1/rooms/${room102}/housekeeping`).set(auth()).send({ housekeeping_status: 'SPARKLING' }).expect(400);
  });

  it('rooms board: property không tồn tại → 404', async () => {
    const res = await board(randomUUID()).expect(404);
    expect(res.body.error.code).toBe('PROPERTY_NOT_FOUND');
  });
});
