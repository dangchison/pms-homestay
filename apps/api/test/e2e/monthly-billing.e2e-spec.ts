import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BillingService } from '@modules/billing/billing.service';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance task 3.8 (docs/03 §4, docs/09 §4.5): ghi chỉ số điện nước; job
 * billing-cycle sinh invoice MONTHLY_RENT — tiền nhà full tháng hoặc pro-rate /30
 * (tháng đầu/cuối) + điện nước = (end−start) × đơn giá; thiếu chỉ số → DRAFT;
 * idempotent theo (booking, billing_period).
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `mbill-${RUN}`;

describe('Monthly billing — thuê tháng (task 3.8)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let tenantId: string;
  let resA: string;
  let resB: string;
  let resC: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const billing = () => app.get(BillingService);

  const quoteMonthly = async (resource: string, ci: string, co: string): Promise<string> =>
    (
      await request(http)
        .post('/api/v1/pricing/quote')
        .set(auth())
        .send({ resource_id: resource, mode: 'MONTHLY', check_in: ci, check_out: co })
        .expect(200)
    ).body.data.quote_id;

  /** booking MONTHLY → force CONFIRMED → CHECKED_IN (sẵn cho billing). */
  const bookMonthlyCheckedIn = async (resource: string, ci: string, co: string): Promise<string> => {
    const id = (
      await request(http)
        .post('/api/v1/bookings')
        .set({ ...auth(), 'Idempotency-Key': randomUUID() })
        .send({ resource_id: resource, quote_id: await quoteMonthly(resource, ci, co), mode: 'MONTHLY', check_in: ci, check_out: co })
        .expect(201)
    ).body.data.id;
    await request(http).post(`/api/v1/bookings/${id}/confirm`).set(auth()).send({ force: true }).expect(200);
    await request(http).post(`/api/v1/bookings/${id}/check-in`).set(auth()).expect(200);
    return id;
  };

  const invoicesOf = async (bookingId: string) =>
    (await request(http).get(`/api/v1/invoices?booking_id=${bookingId}`).set(auth()).expect(200)).body
      .data as Array<{
      kind: string;
      status: string;
      total_vnd: number;
      billing_period: string | null;
      items: Array<{ item_type: string; amount_vnd: number }>;
    }>;

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
        tenant_display_name: 'MBILL E2E',
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

    const propertyId = (
      await request(http)
        .post('/api/v1/properties')
        .set(auth())
        .send({ name: 'P', property_type: 'APARTMENT', address_line: 'a', province: 'Đà Nẵng' })
        .expect(201)
    ).body.data.id;
    const mkRoom = async (n: string) =>
      (await request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: n }).expect(201))
        .body.data.id;
    const room1 = await mkRoom('201');
    const room2 = await mkRoom('202');
    const room3 = await mkRoom('203');
    const resources = (
      await request(http).get(`/api/v1/bookable-resources?property_id=${propertyId}`).set(auth()).expect(200)
    ).body.data as { id: string; room_ids: string[] }[];
    resA = resources.find((r) => r.room_ids.includes(room1))!.id;
    resB = resources.find((r) => r.room_ids.includes(room2))!.id;
    resC = resources.find((r) => r.room_ids.includes(room3))!.id;

    // 1 gói MONTHLY (default cho property) — base 9tr, điện 4000/kWh, nước 15000/m³
    await request(http)
      .post('/api/v1/rate-plans')
      .set(auth())
      .send({
        property_id: propertyId,
        name: 'Thuê tháng',
        mode: 'MONTHLY',
        base_price_vnd: 9_000_000,
        effective_from: '2026-01-01',
        deposit_type: 'NONE',
        monthly_includes_utilities: false,
        monthly_electricity_per_kwh_vnd: 4000,
        monthly_water_per_m3_vnd: 15000,
        resource_ids: [resA, resB, resC],
      })
      .expect(201);

    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id as string;
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM monthly_meter_readings WHERE tenant_id IN ${tid}`);
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
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await app?.close();
  });

  it('★ MONTHLY 16/01→16/04: tiền nhà pro-rate /30 (đầu/cuối), full tháng giữa; idempotent', async () => {
    const id = await bookMonthlyCheckedIn(resA, '2026-01-16T07:00:00.000Z', '2026-04-16T07:00:00.000Z');
    for (const m of [1, 2, 3, 4]) await billing().runMonthlyBilling(tenantId, 2026, m);

    const rows = (
      await admin.query(
        `SELECT i.billing_period bp, ii.amount_vnd::text amt
         FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
         WHERE i.booking_id = $1 AND i.kind = 'MONTHLY_RENT' AND ii.item_type = 'RENT_MONTHLY'
         ORDER BY i.billing_period`,
        [id],
      )
    ).rows as Array<{ bp: string; amt: string }>;

    // base 9tr: T1 16 ngày (16-31) → 9tr×16/30=4,800,000 · T2,T3 full 9,000,000 · T4 15 ngày (1-15) → 4,500,000
    expect(rows.map((r) => `${r.bp}=${r.amt}`)).toEqual([
      '2026-01=4800000',
      '2026-02=9000000',
      '2026-03=9000000',
      '2026-04=4500000',
    ]);

    // idempotent: chạy lại T2 → không sinh thêm invoice MONTHLY_RENT cho booking
    await billing().runMonthlyBilling(tenantId, 2026, 2);
    const n = (
      await admin.query(
        `SELECT count(*)::int n FROM invoices WHERE booking_id = $1 AND kind = 'MONTHLY_RENT'`,
        [id],
      )
    ).rows[0].n;
    expect(n).toBe(4);
  });

  it('★ điện nước từ chỉ số → invoice MONTHLY_RENT ISSUED đủ dòng', async () => {
    const id = await bookMonthlyCheckedIn(resB, '2026-02-01T07:00:00.000Z', '2026-03-01T07:00:00.000Z');
    // ghi chỉ số T2: điện 1000→1150 (150 kWh), nước 10→18 (8 m³)
    await request(http)
      .post('/api/v1/meter-readings')
      .set(auth())
      .send({
        booking_id: id,
        period_year: 2026,
        period_month: 2,
        electricity_kwh_start: 1000,
        electricity_kwh_end: 1150,
        water_m3_start: 10,
        water_m3_end: 18,
      })
      .expect(201);

    await billing().runMonthlyBilling(tenantId, 2026, 2);

    const inv = (await invoicesOf(id)).find((i) => i.kind === 'MONTHLY_RENT')!;
    expect(inv.status).toBe('ISSUED');
    const elec = inv.items.find((it) => it.item_type === 'ELECTRICITY')!;
    const water = inv.items.find((it) => it.item_type === 'WATER')!;
    expect(elec.amount_vnd).toBe(600_000); // 150 × 4000
    expect(water.amount_vnd).toBe(120_000); // 8 × 15000
    // full tháng 9tr + 600k + 120k
    expect(inv.total_vnd).toBe(9_720_000);
  });

  it('thiếu chỉ số điện nước → invoice DRAFT (chỉ tiền nhà)', async () => {
    const id = await bookMonthlyCheckedIn(resC, '2026-02-01T07:00:00.000Z', '2026-03-01T07:00:00.000Z');
    const res = await billing().runMonthlyBilling(tenantId, 2026, 2);
    expect(res.drafts).toBeGreaterThanOrEqual(1);

    const inv = (await invoicesOf(id)).find((i) => i.kind === 'MONTHLY_RENT')!;
    expect(inv.status).toBe('DRAFT');
    expect(inv.items.some((it) => it.item_type === 'ELECTRICITY')).toBe(false);
    expect(inv.items.find((it) => it.item_type === 'RENT_MONTHLY')!.amount_vnd).toBe(9_000_000);
  });

  it('endpoint ghi chỉ số: GET theo booking + upsert (ghi đè kỳ)', async () => {
    const id = await bookMonthlyCheckedIn(resA, '2027-01-01T07:00:00.000Z', '2027-02-01T07:00:00.000Z');
    await request(http)
      .post('/api/v1/meter-readings')
      .set(auth())
      .send({ booking_id: id, period_year: 2027, period_month: 1, electricity_kwh_start: 0, electricity_kwh_end: 100 })
      .expect(201);
    // upsert: ghi lại cùng kỳ với số khác
    await request(http)
      .post('/api/v1/meter-readings')
      .set(auth())
      .send({ booking_id: id, period_year: 2027, period_month: 1, electricity_kwh_start: 0, electricity_kwh_end: 250, water_m3_start: 5, water_m3_end: 12 })
      .expect(201);

    const list = (await request(http).get(`/api/v1/meter-readings?booking_id=${id}`).set(auth()).expect(200)).body
      .data as Array<{ period_month: number; electricity_kwh_end: number; water_m3_end: number }>;
    expect(list).toHaveLength(1); // upsert, không tạo dòng mới
    expect(list[0]!.electricity_kwh_end).toBe(250);
    expect(list[0]!.water_m3_end).toBe(12);
  });
});
