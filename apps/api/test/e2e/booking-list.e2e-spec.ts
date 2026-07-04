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
 * ★ Acceptance task 1.1 (docs/19 §2 Đợt 1): GET /bookings list-by-property nay kèm
 * denormalized `resource_name`/`guest_name` (include bookable_resources+guests) và
 * KHÔNG phá payload cũ. Filter status=CHECKED_IN → mọi phần tử CHECKED_IN; không
 * filter → total_items đủ lớn. Tự tạo dữ liệu (KHÔNG phụ thuộc seed demo — CI an
 * toàn): ≥17 booking trên 2 resource (cửa sổ ngày RỜI nhau), 6 booking ép CHECKED_IN.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `bklist-${RUN}`;
const ownerEmail = `owner-${RUN}@e2e.test`;

// Số booking tạo (>17 để total_items >= 17 chắc chắn); N_CHECKED_IN đầu tiên ép CHECKED_IN.
const N_BOOKINGS = 18;
const N_CHECKED_IN = 6;

describe('Booking list-by-property — GET /bookings (task 1.1)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let propertyId: string;
  let resA: string;
  let resB: string;
  let guestId: string;
  const bookingIds: string[] = [];

  const auth = () => ({ Authorization: `Bearer ${token}` });

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
        .send({
          resource_id: resourceId,
          quote_id: q,
          mode: 'DAILY',
          check_in: ci,
          check_out: co,
          ...(guest ? { guest_id: guest } : {}),
        })
        .expect(201)
    ).body.data.id;
  };

  const list = (qs: string) => request(http).get(`/api/v1/bookings?property_id=${propertyId}${qs}`).set(auth());

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
      .send({ tenant_slug: tenantSlug, tenant_display_name: 'BKLIST E2E', email: ownerEmail, password: PASSWORD, full_name: 'Owner' })
      .expect(201);
    token = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: ownerEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;

    propertyId = (
      await request(http).post('/api/v1/properties').set(auth()).send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' }).expect(201)
    ).body.data.id;
    const room1 = (
      await request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: '101' }).expect(201)
    ).body.data.id;
    const room2 = (
      await request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: '102' }).expect(201)
    ).body.data.id;
    const resources = (
      await request(http).get(`/api/v1/bookable-resources?property_id=${propertyId}`).set(auth()).expect(200)
    ).body.data as { id: string; room_ids: string[] }[];
    resA = resources.find((r) => r.room_ids.includes(room1))!.id;
    resB = resources.find((r) => r.room_ids.includes(room2))!.id;

    await request(http)
      .post('/api/v1/rate-plans')
      .set(auth())
      .send({ property_id: propertyId, name: 'DAILY', mode: 'DAILY', base_price_vnd: 500_000, effective_from: '2026-01-01', resource_ids: [resA, resB] })
      .expect(201);

    guestId = (
      await request(http).post('/api/v1/guests').set(auth()).send({ full_name: 'Nguyễn Văn A', phone: '0900000001' }).expect(201)
    ).body.data.id;

    // 18 booking: xen kẽ 2 resource, cửa sổ 2 đêm RỜI nhau (mỗi booking cách nhau 4 ngày →
    // cùng resource cách 8 ngày, không đụng occupancy). Dùng Date + offset để ISO luôn hợp
    // lệ khi cộng ngày tràn tháng. Tất cả gắn guestId → guest_name có giá trị.
    const BASE = Date.UTC(2026, 7, 1, 7, 0, 0); // 2026-08-01T07:00:00Z
    const DAY_MS = 86_400_000;
    for (let i = 0; i < N_BOOKINGS; i++) {
      const res = i % 2 === 0 ? resA : resB;
      const ci = new Date(BASE + i * 4 * DAY_MS).toISOString();
      const co = new Date(BASE + (i * 4 + 2) * DAY_MS - 2 * 3_600_000).toISOString(); // +2 đêm, trả 05:00Z
      bookingIds.push(await book(res, ci, co, guestId));
    }

    // Ép N_CHECKED_IN booking đầu sang CHECKED_IN (list đọc status trực tiếp). Mirror
    // web-staff-board.e2e-spec: UPDATE trực tiếp qua admin connection.
    const checkedIds = bookingIds.slice(0, N_CHECKED_IN);
    await admin.query(
      `UPDATE bookings SET status='CHECKED_IN', actual_check_in = now() WHERE id = ANY($1::uuid[])`,
      [checkedIds],
    );
  });

  afterAll(async () => {
    // Đóng app TRƯỚC dọn DB: dừng OutboxDispatcher để không sinh thêm notifications (FK → users).
    await app?.close();
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM notifications WHERE tenant_id IN ${tid}`);
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
  });

  it('không filter → total_items >= 17 và mỗi phần tử có resource_name/guest_name', async () => {
    const res = await list(`&page_size=100`).expect(200);
    expect(res.body.page_info.total_items).toBeGreaterThanOrEqual(17);
    const data = res.body.data as { id: string; resource_name: string | null; guest_name: string | null; booking_code: string; status: string; total_amount_vnd: number }[];
    // ≥1 phần tử có resource_name là chuỗi non-empty (join bookable_resources hoạt động).
    expect(data.some((b) => typeof b.resource_name === 'string' && b.resource_name.length > 0)).toBe(true);
    // guest_name điền đúng (mọi booking gắn cùng guest).
    expect(data.every((b) => b.guest_name === 'Nguyễn Văn A')).toBe(true);
  });

  it('payload cũ không vỡ — các field gốc còn nguyên kiểu đúng', async () => {
    const res = await list(`&page_size=1`).expect(200);
    const b = (res.body.data as Record<string, unknown>[])[0]!;
    // field gốc BookingResponse phải còn (không bị include làm mất).
    for (const k of ['id', 'property_id', 'resource_id', 'booking_code', 'source', 'status', 'check_in', 'check_out', 'total_amount_vnd', 'version', 'created_at', 'updated_at']) {
      expect(b).toHaveProperty(k);
    }
    expect(typeof b.total_amount_vnd).toBe('number');
    expect(b.booking_code).toMatch(/^BK-\d{6}-\d{4}$/);
  });

  it('filter status=CHECKED_IN → mọi phần tử CHECKED_IN, data.length >= 1', async () => {
    const res = await list(`&status=CHECKED_IN&page_size=100`).expect(200);
    const data = res.body.data as { status: string; resource_name: string | null }[];
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data.every((b) => b.status === 'CHECKED_IN')).toBe(true);
    // ≥1 phần tử CHECKED_IN có resource_name non-empty.
    expect(data.some((b) => typeof b.resource_name === 'string' && b.resource_name!.length > 0)).toBe(true);
    // đúng số đã ép (không lẫn status khác).
    expect(data.length).toBe(N_CHECKED_IN);
  });

  it('filter status=NO_SHOW → rỗng (không có booking NO_SHOW)', async () => {
    const res = await list(`&status=NO_SHOW`).expect(200);
    expect(res.body.data).toHaveLength(0);
  });
});
