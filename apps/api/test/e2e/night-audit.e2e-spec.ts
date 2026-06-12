import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NightAuditService } from '@modules/night-audit/night-audit.service';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance task 4.6 (docs/03 §7, docs/09 §8): night-audit per-tenant —
 * ② PENDING quá hạn → CANCELLED(DEPOSIT_TIMEOUT) + giải phóng phòng ·
 * ① CONFIRMED quá ngày nhận → NO_SHOW + giải phóng phòng ·
 * ③ invoice quá due_date còn nợ → OVERDUE ·
 * ④ rollup daily_property_stats (occupied/available + doanh thu /đêm) ·
 * ⑤ ngày 1 gọi 3.5/3.6/3.8 · idempotent (chạy lại không double).
 *
 * Dùng `now` cố định 2027-07-01T02:00 (ngày 1 → kích bước tháng) — gọi
 * runForTenant trực tiếp (như sweepExpiredHolds).
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `na-${RUN}`;
const NOW = new Date('2027-07-01T02:00:00.000Z'); // ngày 1 → kích bước tháng (M-1 = 2027-06)

describe('Night-audit (task 4.6)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let tenantId: string;
  let propertyId: string;
  let resA: string;
  let resB: string;
  let resD: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const nightAudit = () => app.get(NightAuditService);

  const quote = async (resource: string, ci: string, co: string): Promise<string> =>
    (
      await request(http)
        .post('/api/v1/pricing/quote')
        .set(auth())
        .send({ resource_id: resource, mode: 'DAILY', check_in: ci, check_out: co })
        .expect(200)
    ).body.data.quote_id;

  const book = async (resource: string, ci: string, co: string): Promise<string> =>
    (
      await request(http)
        .post('/api/v1/bookings')
        .set({ ...auth(), 'Idempotency-Key': randomUUID() })
        .send({ resource_id: resource, quote_id: await quote(resource, ci, co), mode: 'DAILY', check_in: ci, check_out: co })
        .expect(201)
    ).body.data.id;

  const statusOf = async (id: string): Promise<{ status: string; cancellation_reason: string | null }> => {
    const d = (await request(http).get(`/api/v1/bookings/${id}`).set(auth()).expect(200)).body.data;
    return { status: d.status, cancellation_reason: d.cancellation_reason };
  };
  const occCount = async (id: string): Promise<number> =>
    (await admin.query(`SELECT count(*)::int n FROM room_occupancy WHERE booking_id = $1`, [id])).rows[0].n;

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
      .send({ tenant_slug: tenantSlug, tenant_display_name: 'NA E2E', email: `owner-${RUN}@e2e.test`, password: PASSWORD, full_name: 'Owner' })
      .expect(201);
    token = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: `owner-${RUN}@e2e.test`, password: PASSWORD }).expect(200)
    ).body.data.access_token;

    propertyId = (
      await request(http).post('/api/v1/properties').set(auth()).send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' }).expect(201)
    ).body.data.id;
    const mkRoom = async (n: string) =>
      (await request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: n }).expect(201)).body.data.id;
    const r1 = await mkRoom('301');
    const r2 = await mkRoom('302');
    const r3 = await mkRoom('303');
    const resources = (await request(http).get(`/api/v1/bookable-resources?property_id=${propertyId}`).set(auth()).expect(200)).body
      .data as { id: string; room_ids: string[] }[];
    resA = resources.find((r) => r.room_ids.includes(r1))!.id;
    resB = resources.find((r) => r.room_ids.includes(r2))!.id;
    resD = resources.find((r) => r.room_ids.includes(r3))!.id;
    await request(http)
      .post('/api/v1/rate-plans')
      .set(auth())
      .send({ property_id: propertyId, name: 'DAILY', mode: 'DAILY', base_price_vnd: 500_000, effective_from: '2026-01-01', deposit_type: 'NONE', resource_ids: [resA, resB, resD] })
      .expect(201);

    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id as string;
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM daily_property_stats WHERE tenant_id IN ${tid}`);
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

  // booking id giữ giữa 2 test (idempotent)
  let depositId: string;
  let noShowId: string;
  let rollupId: string;
  let invoiceId: string;

  it('★ chạy 4 bước daily + rollup + bước tháng (ngày 1)', async () => {
    // ② deposit-timeout: PENDING + expires_at quá hạn (so với NOW)
    depositId = await book(resA, '2027-08-01T07:00:00.000Z', '2027-08-03T05:00:00.000Z'); // PENDING
    await admin.query(`UPDATE bookings SET expires_at = '2027-06-29T00:00:00Z' WHERE id = $1`, [depositId]);

    // ① no-show: CONFIRMED, ngày nhận (25/06) trước NOW (01/07)
    noShowId = await book(resB, '2027-06-25T07:00:00.000Z', '2027-06-27T05:00:00.000Z');
    await request(http).post(`/api/v1/bookings/${noShowId}/confirm`).set(auth()).send({ force: true }).expect(200);

    // ④ rollup: CHECKED_IN phủ ngày 30/06 (= NOW − 1)
    rollupId = await book(resD, '2027-06-28T07:00:00.000Z', '2027-07-05T05:00:00.000Z'); // 7 đêm × 500k = 3,500,000
    await request(http).post(`/api/v1/bookings/${rollupId}/confirm`).set(auth()).send({ force: true }).expect(200);
    await request(http).post(`/api/v1/bookings/${rollupId}/check-in`).set(auth()).expect(200);

    // ③ overdue: invoice ad-hoc ISSUED còn nợ, due_date quá hạn
    invoiceId = (
      await request(http)
        .post('/api/v1/invoices')
        .set(auth())
        .send({ kind: 'ADJUSTMENT', issue: true, items: [{ item_type: 'SURCHARGE', description: 'Phụ thu', quantity: 1, unit_price_vnd: 500_000 }] })
        .expect(201)
    ).body.data.id;
    await admin.query(`UPDATE invoices SET due_date = '2027-06-20' WHERE id = $1`, [invoiceId]);

    const summary = await nightAudit().runForTenant(tenantId, NOW);

    // ② deposit-timeout
    expect(summary.deposit_timeouts).toBeGreaterThanOrEqual(1);
    expect(await statusOf(depositId)).toEqual({ status: 'CANCELLED', cancellation_reason: 'DEPOSIT_TIMEOUT' });
    expect(await occCount(depositId)).toBe(0);

    // ① no-show
    expect(summary.no_shows).toBeGreaterThanOrEqual(1);
    expect((await statusOf(noShowId)).status).toBe('NO_SHOW');
    expect(await occCount(noShowId)).toBe(0);

    // ③ overdue
    expect(summary.overdue_invoices).toBeGreaterThanOrEqual(1);
    expect((await request(http).get(`/api/v1/invoices/${invoiceId}`).set(auth()).expect(200)).body.data.status).toBe('OVERDUE');

    // ④ rollup ngày 30/06: 1 phòng occupied / 3 phòng available, doanh thu /đêm = 3,500,000 / 7 = 500,000
    const stat = (
      await admin.query(
        `SELECT occupied_room_nights o, available_room_nights a, room_revenue_vnd::text rev, adr_vnd::text adr, revpar_vnd::text revpar
         FROM daily_property_stats WHERE property_id = $1 AND stat_date = '2027-06-30'`,
        [propertyId],
      )
    ).rows[0];
    expect(stat.o).toBe(1);
    expect(stat.a).toBe(3);
    expect(stat.rev).toBe('500000');
    expect(stat.adr).toBe('500000'); // 500k / 1
    expect(stat.revpar).toBe('166667'); // 500k / 3 (làm tròn)

    // ⑤ bước tháng (ngày 1 → chốt 2027-06): orchestrator đã gọi 3.5/3.6/3.8
    expect(summary.monthly?.period).toBe('2027-06');

    // task 4.3: night-audit phát domain events TRONG cùng tx (cancelled/no_show/overdue)
    const evRows = (
      await admin.query(`SELECT event_type, payload FROM outbox_events WHERE tenant_id = $1`, [tenantId])
    ).rows as { event_type: string; payload: Record<string, unknown> }[];
    expect(
      evRows.some((e) => e.event_type === 'booking.cancelled' && e.payload.booking_id === depositId && e.payload.reason === 'DEPOSIT_TIMEOUT'),
    ).toBe(true);
    expect(evRows.some((e) => e.event_type === 'booking.no_show' && e.payload.booking_id === noShowId)).toBe(true);
    expect(evRows.some((e) => e.event_type === 'invoice.overdue' && e.payload.invoice_id === invoiceId)).toBe(true);
  });

  it('idempotent: chạy lại không double (timeout/no_show = 0, trạng thái giữ nguyên)', async () => {
    const s2 = await nightAudit().runForTenant(tenantId, NOW);
    expect(s2.deposit_timeouts).toBe(0); // đã CANCELLED ở lượt trước
    expect(s2.no_shows).toBe(0); // đã NO_SHOW
    expect(s2.overdue_invoices).toBe(0); // đã OVERDUE (không còn ISSUED/PARTIALLY_PAID)

    expect((await statusOf(depositId)).status).toBe('CANCELLED');
    expect((await statusOf(noShowId)).status).toBe('NO_SHOW');
    // rollup upsert lại cùng giá trị (không tạo dòng mới)
    const n = (await admin.query(`SELECT count(*)::int n FROM daily_property_stats WHERE property_id = $1 AND stat_date = '2027-06-30'`, [propertyId])).rows[0].n;
    expect(n).toBe(1);
  });
});
