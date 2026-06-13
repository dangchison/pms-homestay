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
 * ★ Acceptance task 4.1 (docs/03 §4.9): cleaning_tasks auto-sinh khi CHECKED_OUT
 * (+ phòng cũ khi switch-resource); CRUD + assign; vòng đời
 * PENDING→IN_PROGRESS→COMPLETED→VERIFIED; ảnh before/after qua pre-signed S3;
 * housekeeping_status đổi tương ứng DIRTY→CLEANING→INSPECTION→CLEAN.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `clean-${RUN}`;

interface TaskData {
  id: string;
  room_id: string;
  booking_id: string | null;
  task_type: string;
  status: string;
  assigned_to: string | null;
  before_photos: string[];
  after_photos: string[];
  version: number;
}

describe('Cleaning tasks (task 4.1)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let propertyId: string;
  let resA: string;
  let resB: string;
  let room1: string;
  let room2: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const quote = async (resourceId: string, ci: string, co: string): Promise<string> =>
    (
      await request(http)
        .post('/api/v1/pricing/quote')
        .set(auth())
        .send({ resource_id: resourceId, mode: 'DAILY', check_in: ci, check_out: co })
        .expect(200)
    ).body.data.quote_id;

  const book = async (resourceId: string, ci: string, co: string): Promise<string> => {
    const q = await quote(resourceId, ci, co);
    return (
      await request(http)
        .post('/api/v1/bookings')
        .set({ ...auth(), 'Idempotency-Key': randomUUID() })
        .send({ resource_id: resourceId, quote_id: q, mode: 'DAILY', check_in: ci, check_out: co })
        .expect(201)
    ).body.data.id;
  };

  /** Book → CONFIRMED (force) → check-in → check-out. Trả booking id. */
  const bookAndCheckout = async (resourceId: string, ci: string, co: string): Promise<string> => {
    const id = await book(resourceId, ci, co);
    await request(http).post(`/api/v1/bookings/${id}/confirm`).set(auth()).send({ force: true }).expect(200);
    await request(http).post(`/api/v1/bookings/${id}/check-in`).set(auth()).send({}).expect(200);
    await request(http).post(`/api/v1/bookings/${id}/check-out`).set(auth()).send({}).expect(200);
    return id;
  };

  const tasksOf = async (q = ''): Promise<TaskData[]> =>
    (await request(http).get(`/api/v1/cleaning-tasks?property_id=${propertyId}${q}`).set(auth()).expect(200))
      .body.data;

  const housekeepingOf = async (roomId: string): Promise<string> =>
    (await request(http).get(`/api/v1/rooms/${roomId}`).set(auth()).expect(200)).body.data.housekeeping_status;

  const countOutbox = async (eventType: string, aggregateId: string): Promise<number> => {
    const r = await admin.query(
      `SELECT count(*)::int AS n FROM outbox_events WHERE event_type = $1 AND aggregate_id = $2`,
      [eventType, aggregateId],
    );
    return r.rows[0].n as number;
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

    await request(http)
      .post('/api/v1/auth/register')
      .send({
        tenant_slug: tenantSlug,
        tenant_display_name: 'CLEAN E2E',
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

    propertyId = (
      await request(http)
        .post('/api/v1/properties')
        .set(auth())
        .send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' })
        .expect(201)
    ).body.data.id;
    room1 = (
      await request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: '101' }).expect(201)
    ).body.data.id;
    room2 = (
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
      .send({
        property_id: propertyId,
        name: 'DAILY',
        mode: 'DAILY',
        base_price_vnd: 500_000,
        effective_from: '2026-01-01',
        resource_ids: [resA, resB],
      })
      .expect(201);
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM cleaning_tasks WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
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

  it('★ check-out tự sinh cleaning task PENDING (CHECKOUT_CLEAN, gắn booking) + phòng → DIRTY', async () => {
    const bookingId = await bookAndCheckout(resA, '2027-01-02T07:00:00.000Z', '2027-01-04T05:00:00.000Z');

    const tasks = await tasksOf(`&room_id=${room1}&status=PENDING`);
    const task = tasks.find((t) => t.booking_id === bookingId);
    expect(task).toBeDefined();
    expect(task!.task_type).toBe('CHECKOUT_CLEAN');
    expect(task!.status).toBe('PENDING');
    expect(task!.room_id).toBe(room1);
    expect(await housekeepingOf(room1)).toBe('DIRTY');
  });

  it('★ vòng đời: assign → start(CLEANING) → complete(INSPECTION) → verify(CLEAN) + emit cleaning_task.completed', async () => {
    const bookingId = await bookAndCheckout(resA, '2027-02-02T07:00:00.000Z', '2027-02-04T05:00:00.000Z');
    const task = (await tasksOf(`&status=PENDING`)).find((t) => t.booking_id === bookingId)!;
    const assignee = randomUUID();

    // assign (PENDING giữ nguyên, gắn người dọn)
    const assigned = (
      await request(http).post(`/api/v1/cleaning-tasks/${task.id}/assign`).set(auth()).send({ assigned_to: assignee }).expect(200)
    ).body.data;
    expect(assigned.assigned_to).toBe(assignee);
    expect(assigned.status).toBe('PENDING');

    // start → IN_PROGRESS, phòng CLEANING
    const started = (
      await request(http).post(`/api/v1/cleaning-tasks/${task.id}/start`).set(auth()).send({}).expect(200)
    ).body.data;
    expect(started.status).toBe('IN_PROGRESS');
    expect(started.started_at).not.toBeNull();
    expect(await housekeepingOf(task.room_id)).toBe('CLEANING');

    // complete → COMPLETED, phòng INSPECTION
    const completed = (
      await request(http).post(`/api/v1/cleaning-tasks/${task.id}/complete`).set(auth()).send({ notes: 'sạch' }).expect(200)
    ).body.data;
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completed_at).not.toBeNull();
    expect(await housekeepingOf(task.room_id)).toBe('INSPECTION');

    // verify → VERIFIED, phòng CLEAN
    const verified = (
      await request(http).post(`/api/v1/cleaning-tasks/${task.id}/verify`).set(auth()).send({}).expect(200)
    ).body.data;
    expect(verified.status).toBe('VERIFIED');
    expect(verified.verified_by).not.toBeNull();
    expect(await housekeepingOf(task.room_id)).toBe('CLEAN');

    // emit qua outbox cùng tx
    expect(await countOutbox('cleaning_task.completed', task.id)).toBe(1);
    expect(await countOutbox('room.housekeeping_changed', task.room_id)).toBeGreaterThanOrEqual(4);
  });

  it('transition sai → 422: start khi đã VERIFIED, verify khi đang PENDING', async () => {
    const bookingId = await bookAndCheckout(resA, '2027-03-02T07:00:00.000Z', '2027-03-04T05:00:00.000Z');
    const task = (await tasksOf(`&status=PENDING`)).find((t) => t.booking_id === bookingId)!;

    // verify khi PENDING → 422
    const earlyVerify = await request(http).post(`/api/v1/cleaning-tasks/${task.id}/verify`).set(auth()).send({});
    expect(earlyVerify.status).toBe(422);
    expect(earlyVerify.body.error.code).toBe('CLEANING_TASK_INVALID_STATUS');

    // đẩy tới VERIFIED rồi start lại → 422
    await request(http).post(`/api/v1/cleaning-tasks/${task.id}/start`).set(auth()).send({}).expect(200);
    await request(http).post(`/api/v1/cleaning-tasks/${task.id}/complete`).set(auth()).send({}).expect(200);
    await request(http).post(`/api/v1/cleaning-tasks/${task.id}/verify`).set(auth()).send({}).expect(200);
    const lateStart = await request(http).post(`/api/v1/cleaning-tasks/${task.id}/start`).set(auth()).send({});
    expect(lateStart.status).toBe(422);
    expect(lateStart.body.error.code).toBe('CLEANING_TASK_INVALID_STATUS');
  });

  it('★ presign ảnh S3 + đính before/after; key sai prefix → 422', async () => {
    // task thủ công DEEP_CLEAN (PENDING)
    const task = (
      await request(http)
        .post('/api/v1/cleaning-tasks')
        .set(auth())
        .send({ property_id: propertyId, room_id: room2, task_type: 'DEEP_CLEAN' })
        .expect(201)
    ).body.data as TaskData;
    expect(task.task_type).toBe('DEEP_CLEAN');

    // presign before
    const presign = (
      await request(http)
        .post(`/api/v1/cleaning-tasks/${task.id}/photos/presign`)
        .set(auth())
        .send({ phase: 'before', content_type: 'image/jpeg' })
        .expect(200)
    ).body.data as { key: string; upload_url: string; expires_in: number };
    expect(presign.key).toContain(`cleaning/`);
    expect(presign.key).toContain(`/${task.id}/before/`);
    expect(presign.upload_url).toMatch(/^https?:\/\//); // PUT URL tới S3 endpoint
    expect(presign.upload_url).toContain(presign.key); // key nằm trong path
    expect(presign.upload_url).toContain('X-Amz-Signature'); // SigV4 presigned
    expect(presign.expires_in).toBeGreaterThan(0);

    // start với before_photos hợp lệ (đã upload xong client-side)
    const started = (
      await request(http)
        .post(`/api/v1/cleaning-tasks/${task.id}/start`)
        .set(auth())
        .send({ before_photos: [presign.key] })
        .expect(200)
    ).body.data as TaskData;
    expect(started.before_photos).toContain(presign.key);

    // complete với after_photos
    const afterPresign = (
      await request(http)
        .post(`/api/v1/cleaning-tasks/${task.id}/photos/presign`)
        .set(auth())
        .send({ phase: 'after', content_type: 'image/png' })
        .expect(200)
    ).body.data as { key: string };
    const completed = (
      await request(http)
        .post(`/api/v1/cleaning-tasks/${task.id}/complete`)
        .set(auth())
        .send({ after_photos: [afterPresign.key] })
        .expect(200)
    ).body.data as TaskData;
    expect(completed.after_photos).toContain(afterPresign.key);

    // key không thuộc task này → 422
    const task2 = (
      await request(http)
        .post('/api/v1/cleaning-tasks')
        .set(auth())
        .send({ property_id: propertyId, room_id: room2, task_type: 'MAINTENANCE' })
        .expect(201)
    ).body.data as TaskData;
    const bad = await request(http)
      .post(`/api/v1/cleaning-tasks/${task2.id}/start`)
      .set(auth())
      .send({ before_photos: ['cleaning/some-other-tenant/some-task/before/x'] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('CLEANING_PHOTO_INVALID_KEY');
  });

  it('PATCH If-Match (priority/notes) — lệch version → 409; CRUD get/list', async () => {
    const task = (
      await request(http)
        .post('/api/v1/cleaning-tasks')
        .set(auth())
        .send({ property_id: propertyId, room_id: room1, task_type: 'MAINTENANCE', priority: 1, notes: 'kiểm tra điều hoà' })
        .expect(201)
    ).body.data as TaskData;
    expect(task.version).toBe(0);

    // If-Match đúng → 200, version bump
    const upd = (
      await request(http)
        .patch(`/api/v1/cleaning-tasks/${task.id}`)
        .set({ ...auth(), 'If-Match': '0' })
        .send({ priority: 5 })
        .expect(200)
    ).body.data as TaskData;
    expect(upd.version).toBe(1);

    // If-Match cũ → 409
    const stale = await request(http)
      .patch(`/api/v1/cleaning-tasks/${task.id}`)
      .set({ ...auth(), 'If-Match': '0' })
      .send({ priority: 9 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    // get
    const got = (await request(http).get(`/api/v1/cleaning-tasks/${task.id}`).set(auth()).expect(200)).body.data;
    expect(got.priority).toBe(5);
  });

  it('★ switch-resource sinh cleaning task cho phòng cũ + phòng cũ → DIRTY', async () => {
    const id = await book(resA, '2027-04-02T07:00:00.000Z', '2027-04-04T05:00:00.000Z');
    await request(http)
      .post(`/api/v1/bookings/${id}/switch-resource`)
      .set(auth())
      .send({ new_resource_id: resB, reason: 'khách đổi phòng' })
      .expect(200);

    // phòng cũ room1 có task gắn booking này
    const tasks = await tasksOf(`&room_id=${room1}`);
    const task = tasks.find((t) => t.booking_id === id);
    expect(task).toBeDefined();
    expect(task!.room_id).toBe(room1);
    expect(await housekeepingOf(room1)).toBe('DIRTY');
  });

  it('huỷ task (PENDING → CANCELLED) cần lý do', async () => {
    const task = (
      await request(http)
        .post('/api/v1/cleaning-tasks')
        .set(auth())
        .send({ property_id: propertyId, room_id: room1, task_type: 'DEEP_CLEAN' })
        .expect(201)
    ).body.data as TaskData;
    const cancelled = (
      await request(http).post(`/api/v1/cleaning-tasks/${task.id}/cancel`).set(auth()).send({ reason: 'trùng task' }).expect(200)
    ).body.data as TaskData;
    expect(cancelled.status).toBe('CANCELLED');

    // huỷ lần nữa → 422
    const again = await request(http).post(`/api/v1/cleaning-tasks/${task.id}/cancel`).set(auth()).send({ reason: 'x' });
    expect(again.status).toBe(422);
  });
});
