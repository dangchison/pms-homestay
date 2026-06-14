import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';
import { IcalSyncService } from '@modules/channels/ical-sync.service';

/**
 * ★ Acceptance task 5.2 (docs/08 §3): iCal pull worker — fetch+parse ngoài tx,
 * tạo/huỷ booking OTA qua createBookingTx (choke-point occupancy), conflict 23P01
 * → booking.overbooking_detected (không auto-resolve), sanity-guard chống mất
 * booking (feed teo >50% → skip; huỷ vắng mặt ≥2 lần). Fixture: all-day, timezone,
 * cancelled, feed-rỗng-không-hủy. Test gọi syncMapping(rawFeed) trực tiếp.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `icalpull-${RUN}`;
const ownerEmail = `owner-${RUN}@e2e.test`;
const staffEmail = `staff-${RUN}@e2e.test`;

const vevent = (uid: string, start: string, end: string, opts: { summary?: string; cancelled?: boolean } = {}) =>
  [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${opts.summary ?? 'Reserved'}`,
    ...(opts.cancelled ? ['STATUS:CANCELLED'] : []),
    'END:VEVENT',
  ].join('\n');

const ical = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Airbnb//EN', ...events, 'END:VCALENDAR'].join('\n');

describe('iCal pull worker (task 5.2)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let staffToken: string;
  let tenantId: string;
  let propertyId: string;
  let channel1: string;
  let channel2: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const sync = (tenant: string, mappingId: string, rawFeed: string) =>
    app.get(IcalSyncService).syncMapping(tenant, mappingId, { rawFeed });

  const createRoomResource = async (roomNumber: string): Promise<string> => {
    const roomId = (
      await request(http)
        .post('/api/v1/rooms')
        .set(auth())
        .send({ property_id: propertyId, room_number: roomNumber })
        .expect(201)
    ).body.data.id;
    const res = await request(http)
      .get(`/api/v1/bookable-resources?property_id=${propertyId}`)
      .set(auth())
      .expect(200);
    return (res.body.data as { id: string; room_ids: string[] }[]).find((r) => r.room_ids.includes(roomId))!.id;
  };

  const createMapping = async (channelId: string, resourceId: string, listingId: string): Promise<string> =>
    (
      await request(http)
        .post(`/api/v1/channels/${channelId}/mappings`)
        .set(auth())
        .send({ resource_id: resourceId, external_listing_id: listingId, ical_pull_url: 'https://example.com/x.ics' })
        .expect(201)
    ).body.data.id;

  const bookingsOf = async (mappingId: string): Promise<{ external_uid: string; status: string; check_in: string; check_out: string; missing_sync_count: number }[]> =>
    (
      await admin.query(
        `SELECT external_uid, status, check_in, check_out, missing_sync_count FROM bookings WHERE channel_mapping_id = $1 ORDER BY external_uid`,
        [mappingId],
      )
    ).rows;

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
      .send({ tenant_slug: tenantSlug, tenant_display_name: 'ICAL E2E', email: ownerEmail, password: PASSWORD, full_name: 'Owner' })
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
      await request(http)
        .post('/api/v1/properties')
        .set(auth())
        .send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' })
        .expect(201)
    ).body.data.id;

    const mkChannel = async (name: string): Promise<string> =>
      (
        await request(http)
          .post('/api/v1/channels')
          .set(auth())
          .send({ property_id: propertyId, channel_type: 'AIRBNB_ICAL', display_name: name })
          .expect(201)
      ).body.data.id;
    channel1 = await mkChannel('Airbnb-1');
    channel2 = await mkChannel('Airbnb-2');

    const staffHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const staff = await admin.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, default_role) VALUES ($1,$2,$3,'Staff','STAFF') RETURNING id`,
      [tenantId, staffEmail, staffHash],
    );
    await admin.query(
      `INSERT INTO user_property_roles (tenant_id, user_id, property_id, role) VALUES ($1,$2,$3,'STAFF')`,
      [tenantId, staff.rows[0].id, propertyId],
    );
    staffToken = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: staffEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM sync_logs WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM sync_jobs WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM channel_resource_mappings WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM channels WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM room_occupancy WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM booking_status_history WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM bookings WHERE tenant_id IN ${tid}`);
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

  it('all-day VEVENT → tạo booking CONFIRMED source OTA + check_in/out đúng timezone property (+07)', async () => {
    const res = await createRoomResource('A1');
    const m = await createMapping(channel1, res, 'LST-A');
    const result = await sync(tenantId, m, ical(vevent('uid-a', '20270202', '20270204')));
    expect(result.created).toBe(1);
    expect(result.status).toBe('SUCCESS');

    const rows = await bookingsOf(m);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('CONFIRMED');
    expect(rows[0]!.external_uid).toBe('uid-a');
    // 2027-02-02 00:00 Asia/Ho_Chi_Minh = 2027-02-01T17:00:00Z (all-day + timezone).
    expect(new Date(rows[0]!.check_in).toISOString()).toBe('2027-02-01T17:00:00.000Z');
    expect(new Date(rows[0]!.check_out).toISOString()).toBe('2027-02-03T17:00:00.000Z');
    const src = await admin.query(`SELECT source FROM bookings WHERE channel_mapping_id = $1`, [m]);
    expect(src.rows[0].source).toBe('AIRBNB_ICAL');
  });

  it('re-sync cùng feed → idempotent (created=0, không nhân đôi)', async () => {
    const res = await createRoomResource('B1');
    const m = await createMapping(channel1, res, 'LST-B');
    const feed = ical(vevent('uid-b', '20270302', '20270305'));
    expect((await sync(tenantId, m, feed)).created).toBe(1);
    const second = await sync(tenantId, m, feed);
    expect(second.created).toBe(0);
    expect((await bookingsOf(m)).filter((b) => b.status === 'CONFIRMED')).toHaveLength(1);
  });

  it('STATUS:CANCELLED → huỷ booking ngay (bỏ qua sanity-guard)', async () => {
    const res = await createRoomResource('C1');
    const m = await createMapping(channel1, res, 'LST-C');
    await sync(tenantId, m, ical(vevent('uid-c', '20270402', '20270404')));
    const result = await sync(tenantId, m, ical(vevent('uid-c', '20270402', '20270404', { cancelled: true })));
    expect(result.cancelled).toBe(1);
    expect((await bookingsOf(m))[0]!.status).toBe('CANCELLED');
  });

  it('sanity-guard: feed rỗng (< 50% baseline) → KHÔNG huỷ booking + log WARN', async () => {
    const res = await createRoomResource('D1');
    const m = await createMapping(channel1, res, 'LST-D');
    await sync(tenantId, m, ical(vevent('uid-d1', '20270502', '20270504'), vevent('uid-d2', '20270602', '20270604')));
    const result = await sync(tenantId, m, ical()); // feed rỗng → guard
    expect(result.guard_triggered).toBe(true);
    expect(result.cancelled).toBe(0);
    expect((await bookingsOf(m)).filter((b) => b.status === 'CONFIRMED')).toHaveLength(2); // giữ nguyên
    const warn = await admin.query(
      `SELECT count(*)::int AS n FROM sync_logs WHERE tenant_id = $1 AND level = 'WARN' AND message LIKE 'Sanity-guard%'`,
      [tenantId],
    );
    expect(warn.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('vắng mặt (không CANCELLED) → chỉ huỷ sau ≥2 lần liên tiếp (missing_sync_count)', async () => {
    const res = await createRoomResource('E1');
    const m = await createMapping(channel1, res, 'LST-E');
    // baseline 2 sự kiện
    await sync(tenantId, m, ical(vevent('uid-e1', '20270702', '20270704'), vevent('uid-e2', '20270802', '20270804')));
    // feed còn 1 (1 < 2*0.5=1 → false → KHÔNG teo) → e2 vắng lần 1 (chưa huỷ)
    const r1 = await sync(tenantId, m, ical(vevent('uid-e1', '20270702', '20270704')));
    expect(r1.cancelled).toBe(0);
    let e2 = (await bookingsOf(m)).find((b) => b.external_uid === 'uid-e2')!;
    expect(e2.status).toBe('CONFIRMED');
    expect(e2.missing_sync_count).toBe(1);
    // vắng lần 2 → huỷ
    const r2 = await sync(tenantId, m, ical(vevent('uid-e1', '20270702', '20270704')));
    expect(r2.cancelled).toBe(1);
    e2 = (await bookingsOf(m)).find((b) => b.external_uid === 'uid-e2')!;
    expect(e2.status).toBe('CANCELLED');
  });

  it('overbooking: 2 kênh map cùng resource, feed trùng khoảng → conflict + booking.overbooking_detected (không auto-resolve)', async () => {
    const res = await createRoomResource('F1');
    const mA = await createMapping(channel1, res, 'LST-F-A');
    const mB = await createMapping(channel2, res, 'LST-F-B');
    expect((await sync(tenantId, mA, ical(vevent('uid-f-a', '20270901', '20270903')))).created).toBe(1);
    // feed kênh 2 trùng khoảng trên CÙNG resource → EXCLUDE 23P01
    const result = await sync(tenantId, mB, ical(vevent('uid-f-b', '20270902', '20270904')));
    expect(result.conflicts).toBe(1);
    expect(result.created).toBe(0);
    expect(result.status).toBe('PARTIAL');
    const ob = await admin.query(
      `SELECT count(*)::int AS n FROM outbox_events WHERE tenant_id = $1 AND event_type = 'booking.overbooking_detected'`,
      [tenantId],
    );
    expect(ob.rows[0].n).toBeGreaterThanOrEqual(1);
    const job = await admin.query(
      `SELECT conflict_count, status FROM sync_jobs WHERE channel_mapping_id = $1 ORDER BY started_at DESC LIMIT 1`,
      [mB],
    );
    expect(job.rows[0].conflict_count).toBe(1);
    expect(job.rows[0].status).toBe('PARTIAL');
  });

  it('sync-now endpoint: STAFF (không channel.manage) → 403; mapping sai → 404', async () => {
    const res = await createRoomResource('G1');
    const m = await createMapping(channel1, res, 'LST-G');
    await request(http)
      .post(`/api/v1/channel-mappings/${m}/sync`)
      .set({ Authorization: `Bearer ${staffToken}` })
      .expect(403);
    await request(http)
      .post('/api/v1/channel-mappings/00000000-0000-0000-0000-000000000000/sync')
      .set(auth())
      .expect(404);
  });

  it('GET /channels/:id/sync-jobs: trả lịch sử job đã chạy', async () => {
    const res = await request(http).get(`/api/v1/channels/${channel1}/sync-jobs`).set(auth()).expect(200);
    const jobs = res.body.data as { status: string; job_type: string }[];
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => j.job_type === 'PULL_ICAL')).toBe(true);
    expect(jobs.some((j) => j.status === 'SUCCESS')).toBe(true);
  });
});
