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
import { IcalSyncService } from '@modules/channels/ical-sync.service';

/**
 * ★ Acceptance task 5.3 (docs/08 §3 + roadmap): endpoint PUSH iCal công khai
 * `GET /api/v1/public/sync/ical/:token` — busy của resource qua occupancy; statuses
 * PENDING/CONFIRMED/CHECKED_IN (KHÔNG gồm HOLD); từ now; ETag + If-None-Match → 304;
 * rate limit 10/min/IP/token; KHÔNG PII trong SUMMARY. Token resolve CROSS-TENANT
 * qua SECURITY DEFINER function (channel_resource_mappings có FORCE RLS).
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `icalpush-${RUN}`;
const ownerEmail = `owner-${RUN}@e2e.test`;

const vevent = (uid: string, start: string, end: string, summary: string) =>
  ['BEGIN:VEVENT', `UID:${uid}`, `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`, `SUMMARY:${summary}`, 'END:VEVENT'].join('\n');

const ical = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Airbnb//EN', ...events, 'END:VCALENDAR'].join('\n');

describe('iCal push endpoint (task 5.3)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let tenantId: string;
  let propertyId: string;
  let channelId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const createRoomResource = async (roomNumber: string): Promise<string> => {
    const roomId = (
      await request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: roomNumber }).expect(201)
    ).body.data.id;
    const res = await request(http).get(`/api/v1/bookable-resources?property_id=${propertyId}`).set(auth()).expect(200);
    return (res.body.data as { id: string; room_ids: string[] }[]).find((r) => r.room_ids.includes(roomId))!.id;
  };

  /** Tạo mapping → trả {id, token} (ical_push_token sinh ở DB). */
  const createMapping = async (resourceId: string, listingId: string): Promise<{ id: string; token: string }> => {
    const r = await request(http)
      .post(`/api/v1/channels/${channelId}/mappings`)
      .set(auth())
      .send({ resource_id: resourceId, external_listing_id: listingId })
      .expect(201);
    return { id: r.body.data.id, token: r.body.data.ical_push_token };
  };

  const otaSync = (mappingId: string, rawFeed: string) =>
    app.get(IcalSyncService).syncMapping(tenantId, mappingId, { rawFeed });

  /** GET feed công khai — KHÔNG auth (endpoint @Public). */
  const getIcal = (tok: string, headers: Record<string, string> = {}) =>
    request(http).get(`/api/v1/public/sync/ical/${tok}`).set(headers);

  const createRatePlan = (resourceId: string, name: string) =>
    request(http)
      .post('/api/v1/rate-plans')
      .set(auth())
      .send({ property_id: propertyId, name, mode: 'DAILY', base_price_vnd: 500_000, effective_from: '2026-01-01', resource_ids: [resourceId] })
      .expect(201);

  const quote = async (resourceId: string, ci: string, co: string): Promise<string> =>
    (
      await request(http).post('/api/v1/pricing/quote').set(auth()).send({ resource_id: resourceId, mode: 'DAILY', check_in: ci, check_out: co }).expect(200)
    ).body.data.quote_id;

  const book = (resourceId: string, quoteId: string, ci: string, co: string, hold: boolean) =>
    request(http)
      .post('/api/v1/bookings')
      .set({ ...auth(), 'Idempotency-Key': randomUUID() })
      .send({ resource_id: resourceId, quote_id: quoteId, mode: 'DAILY', check_in: ci, check_out: co, hold });

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
      .send({ tenant_slug: tenantSlug, tenant_display_name: 'ICAL PUSH E2E', email: ownerEmail, password: PASSWORD, full_name: 'Owner' })
      .expect(201);
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id;
    await admin.query(
      `UPDATE tenants SET subscription_plan_id = (SELECT id FROM subscription_plans WHERE code = 'ENTERPRISE') WHERE id = $1`,
      [tenantId],
    );
    token = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: ownerEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;

    propertyId = (
      await request(http).post('/api/v1/properties').set(auth()).send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' }).expect(201)
    ).body.data.id;
    channelId = (
      await request(http).post('/api/v1/channels').set(auth()).send({ property_id: propertyId, channel_type: 'AIRBNB_ICAL', display_name: 'Airbnb' }).expect(201)
    ).body.data.id;
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM sync_logs WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM sync_jobs WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM channel_resource_mappings WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM channels WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM invoice_items WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM invoices WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM room_occupancy WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM booking_status_history WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM quotes WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM bookings WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM rate_plans WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM idempotency_keys WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM document_counters WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM resource_members WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM bookable_resources WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM rooms WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await app?.close();
  });

  it('booking CONFIRMED → VCALENDAR busy text/calendar, SUMMARY:Reserved, KHÔNG PII, thời gian UTC đúng', async () => {
    const res = await createRoomResource('A1');
    const m = await createMapping(res, 'LST-A');
    // OTA feed cố ý nhét tên + SĐT khách vào SUMMARY → push KHÔNG được lộ.
    await otaSync(m.id, ical(vevent('uid-a', '20270410', '20270412', 'Nguyen Van A - 0901234567')));

    const r = await getIcal(m.token).expect(200);
    expect(r.headers['content-type']).toContain('text/calendar');
    expect(r.headers.etag).toBeDefined();
    const feed = r.text;
    expect(feed).toContain('BEGIN:VCALENDAR');
    expect(feed).toContain('BEGIN:VEVENT');
    expect(feed).toContain('SUMMARY:Reserved');
    // KHÔNG PII: tên/SĐT khách tuyệt đối không xuất hiện.
    expect(feed).not.toContain('Nguyen Van A');
    expect(feed).not.toContain('0901234567');
    // all-day 2027-04-10 +07 = 2027-04-09T17:00:00Z; buffer 0 → DTSTART khớp.
    expect(feed).toContain('DTSTART:20270409T170000Z');
    expect(feed).toContain('DTEND:20270411T170000Z');
    expect(feed.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('ETag + If-None-Match → 304 (không đổi data thì khớp)', async () => {
    const res = await createRoomResource('B1');
    const m = await createMapping(res, 'LST-B');
    await otaSync(m.id, ical(vevent('uid-b', '20270510', '20270512', 'Reserved')));

    const first = await getIcal(m.token).expect(200);
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^"[a-f0-9]+"$/);
    await getIcal(m.token, { 'If-None-Match': etag }).expect(304);
  });

  it('HOLD → KHÔNG xuất hiện trong feed (chỉ PENDING/CONFIRMED/CHECKED_IN)', async () => {
    const res = await createRoomResource('C1');
    const m = await createMapping(res, 'LST-C');
    await createRatePlan(res, `DAILY-C-${RUN}`);
    const ci = '2027-06-10T07:00:00.000Z';
    const co = '2027-06-12T05:00:00.000Z';
    const created = await book(res, await quote(res, ci, co), ci, co, true).expect(201);
    expect(created.body.data.status).toBe('HOLD');

    const feed = (await getIcal(m.token).expect(200)).text;
    expect(feed).toContain('BEGIN:VCALENDAR');
    expect(feed).not.toContain('BEGIN:VEVENT'); // HOLD bị loại → feed rỗng
  });

  it('PENDING busy, sau khi CANCELLED → biến mất khỏi feed (occupancy bị xoá)', async () => {
    const res = await createRoomResource('D1');
    const m = await createMapping(res, 'LST-D');
    await createRatePlan(res, `DAILY-D-${RUN}`);
    const ci = '2027-07-10T07:00:00.000Z';
    const co = '2027-07-12T05:00:00.000Z';
    const created = await book(res, await quote(res, ci, co), ci, co, false).expect(201);
    expect(created.body.data.status).toBe('PENDING');

    expect((await getIcal(m.token).expect(200)).text).toContain('BEGIN:VEVENT'); // PENDING = busy

    await request(http).post(`/api/v1/bookings/${created.body.data.id}/cancel`).set(auth()).send({ reason: 'test' }).expect(200);
    expect((await getIcal(m.token).expect(200)).text).not.toContain('BEGIN:VEVENT'); // huỷ → occupancy xoá
  });

  it('token sai định dạng / không tồn tại / mapping inactive → 404', async () => {
    await getIcal('not-a-valid-token').expect(404); // sai định dạng
    await getIcal('a'.repeat(48)).expect(404); // đúng định dạng nhưng không tồn tại

    const res = await createRoomResource('E1');
    const m = await createMapping(res, 'LST-E');
    await getIcal(m.token).expect(200); // active OK
    await request(http).patch(`/api/v1/channel-mappings/${m.id}`).set(auth()).send({ is_active: false }).expect(200);
    await getIcal(m.token).expect(404); // inactive → resolve trả 0 dòng
  });

  it('rate limit 10/min/IP/token → request thứ 11 trả 429', async () => {
    const res = await createRoomResource('F1');
    const m = await createMapping(res, 'LST-F'); // feed rỗng vẫn 200

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await getIcal(m.token)).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
