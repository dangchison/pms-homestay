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
 * ★ Acceptance task 4.3 (docs/10 §2): mọi mutation quan trọng publish outbox TRONG
 * tx; payload đúng shape shared-types/events.ts (gồm property_id để filter SSE).
 * Kiểm: trigger từng mutation qua API → khẳng định 1 dòng outbox_events đúng
 * event_type + payload. ENABLE_SCHEDULERS=false → dispatcher không nuốt row (giữ
 * PENDING để admin đọc). Night-audit events (no_show/deposit_timeout/overdue) được
 * assert ở night-audit.e2e-spec.ts (đã có setup).
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `evt-${RUN}`;

/** Window đặt phòng riêng theo tháng (2027-MM-01..03) → tránh trùng occupancy. */
const win = (month: number): { ci: string; co: string } => {
  const mm = String(month).padStart(2, '0');
  return { ci: `2027-${mm}-01T07:00:00.000Z`, co: `2027-${mm}-03T05:00:00.000Z` };
};

interface OutboxRow {
  event_type: string;
  payload: Record<string, unknown>;
}

describe('Domain events emit (task 4.3)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let tenantId: string;
  let propertyId: string;
  let resA: string;
  let resB: string;
  let roomA: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const eventsByAgg = async (aggId: string): Promise<OutboxRow[]> =>
    (
      await admin.query(
        `SELECT event_type, payload FROM outbox_events WHERE tenant_id = $1 AND aggregate_id = $2 ORDER BY created_at`,
        [tenantId, aggId],
      )
    ).rows as OutboxRow[];

  const findEvent = async (aggId: string, type: string): Promise<Record<string, unknown> | undefined> =>
    (await eventsByAgg(aggId)).find((r) => r.event_type === type)?.payload;

  /** Tìm event theo type + payload.booking_id (cho payment.* — aggregate là payment id). */
  const eventByBooking = async (type: string, bookingId: string): Promise<OutboxRow | undefined> =>
    (
      await admin.query(
        `SELECT event_type, payload FROM outbox_events WHERE tenant_id = $1 AND event_type = $2 AND payload->>'booking_id' = $3`,
        [tenantId, type, bookingId],
      )
    ).rows[0] as OutboxRow | undefined;

  const quote = async (resource: string, w: { ci: string; co: string }): Promise<string> =>
    (
      await request(http)
        .post('/api/v1/pricing/quote')
        .set(auth())
        .send({ resource_id: resource, mode: 'DAILY', check_in: w.ci, check_out: w.co })
        .expect(200)
    ).body.data.quote_id;

  const book = async (resource: string, w: { ci: string; co: string }): Promise<string> =>
    (
      await request(http)
        .post('/api/v1/bookings')
        .set({ ...auth(), 'Idempotency-Key': randomUUID() })
        .send({ resource_id: resource, quote_id: await quote(resource, w), mode: 'DAILY', check_in: w.ci, check_out: w.co })
        .expect(201)
    ).body.data.id;

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
      .send({ tenant_slug: tenantSlug, tenant_display_name: 'EVT', email: `owner-${RUN}@e2e.test`, password: PASSWORD, full_name: 'Owner' })
      .expect(201);
    token = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: `owner-${RUN}@e2e.test`, password: PASSWORD }).expect(200)
    ).body.data.access_token;

    propertyId = (
      await request(http).post('/api/v1/properties').set(auth()).send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' }).expect(201)
    ).body.data.id;
    const mkRoom = async (n: string) =>
      (await request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: n }).expect(201)).body.data.id;
    roomA = await mkRoom('501');
    const roomB = await mkRoom('502');
    const resources = (await request(http).get(`/api/v1/bookable-resources?property_id=${propertyId}`).set(auth()).expect(200)).body
      .data as { id: string; room_ids: string[] }[];
    resA = resources.find((r) => r.room_ids.includes(roomA))!.id;
    resB = resources.find((r) => r.room_ids.includes(roomB))!.id;
    // Gói giá có cọc 30% → mỗi booking sinh DEPOSIT invoice (phục vụ test payment).
    await request(http)
      .post('/api/v1/rate-plans')
      .set(auth())
      .send({ property_id: propertyId, name: 'Cọc 30%', mode: 'DAILY', base_price_vnd: 500_000, effective_from: '2026-01-01', deposit_type: 'PERCENT', deposit_value: 3000, resource_ids: [resA, resB] })
      .expect(201);

    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id as string;
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      for (const t of [
        'outbox_events', 'cleaning_tasks', 'payment_attempts', 'payments', 'invoice_items', 'invoices',
        'room_occupancy', 'room_blocks', 'booking_status_history', 'quotes', 'bookings',
        'rate_plans', 'resource_members', 'bookable_resources', 'rooms', 'idempotency_keys',
        'document_counters', 'user_property_roles', 'properties', 'refresh_tokens', 'users',
      ]) {
        await admin.query(`DELETE FROM ${t} WHERE tenant_id IN ${tid}`);
      }
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await app?.close();
  });

  it('booking.created — payload { booking_id, property_id }', async () => {
    const id = await book(resA, win(3));
    const payload = await findEvent(id, 'booking.created');
    expect(payload).toMatchObject({ booking_id: id, property_id: propertyId });
  });

  it('booking.confirmed (force) + checked_in + checked_out — vòng đời', async () => {
    const id = await book(resA, win(4));
    await request(http).post(`/api/v1/bookings/${id}/confirm`).set(auth()).send({ force: true }).expect(200);
    await request(http).post(`/api/v1/bookings/${id}/check-in`).set(auth()).expect(200);
    await request(http).post(`/api/v1/bookings/${id}/check-out`).set(auth()).expect(200);
    const types = (await eventsByAgg(id)).map((e) => e.event_type);
    expect(types).toEqual(expect.arrayContaining(['booking.created', 'booking.confirmed', 'booking.checked_in', 'booking.checked_out']));
    expect(await findEvent(id, 'booking.checked_out')).toMatchObject({ booking_id: id, property_id: propertyId });
  });

  it('booking.cancelled — kèm reason', async () => {
    const id = await book(resA, win(5));
    await request(http).post(`/api/v1/bookings/${id}/cancel`).set(auth()).send({ reason: 'Khách đổi ý' }).expect(200);
    expect(await findEvent(id, 'booking.cancelled')).toMatchObject({ booking_id: id, property_id: propertyId, reason: 'Khách đổi ý' });
  });

  it('booking.resource_switched', async () => {
    const id = await book(resA, win(6));
    await request(http).post(`/api/v1/bookings/${id}/confirm`).set(auth()).send({ force: true }).expect(200);
    await request(http).post(`/api/v1/bookings/${id}/switch-resource`).set(auth()).send({ new_resource_id: resB, reason: 'Nâng phòng' }).expect(200);
    expect(await findEvent(id, 'booking.resource_switched')).toMatchObject({ booking_id: id, property_id: propertyId });
  });

  it('payment.received + booking.confirmed khi trả cọc; payment.refunded khi hoàn', async () => {
    const id = await book(resA, win(7)); // PENDING + DEPOSIT invoice tự sinh
    const invoices = (await request(http).get(`/api/v1/invoices?booking_id=${id}`).set(auth()).expect(200)).body.data as {
      id: string;
      kind: string;
      total_vnd: number;
    }[];
    const deposit = invoices.find((i) => i.kind === 'DEPOSIT')!;
    const payRes = await request(http)
      .post('/api/v1/payments')
      .set({ ...auth(), 'Idempotency-Key': randomUUID() })
      .send({ invoice_id: deposit.id, amount_vnd: deposit.total_vnd, method: 'CASH' })
      .expect(201);
    const paymentId = payRes.body.data.id as string;

    // payment.received (aggregate = payment) + payload.booking_id
    expect(await findEvent(paymentId, 'payment.received')).toMatchObject({ payment_id: paymentId, invoice_id: deposit.id, property_id: propertyId, booking_id: id });
    // cọc đủ → booking tự CONFIRMED → booking.confirmed (qua confirmFromDepositPaid)
    expect(await eventByBooking('booking.confirmed', id)).toBeDefined();

    // refund → payment.refunded
    await request(http).post(`/api/v1/payments/${paymentId}/refund`).set(auth()).send({ reason: 'Huỷ' }).expect(200);
    expect(await findEvent(paymentId, 'payment.refunded')).toMatchObject({ payment_id: paymentId, property_id: propertyId });
  });

  it('invoice.issued — phát hành ad-hoc', async () => {
    const inv = (
      await request(http)
        .post('/api/v1/invoices')
        .set(auth())
        .send({ kind: 'ADJUSTMENT', issue: true, items: [{ item_type: 'SURCHARGE', description: 'Dịch vụ', quantity: 1, unit_price_vnd: 200_000 }] })
        .expect(201)
    ).body.data.id as string;
    expect(await findEvent(inv, 'invoice.issued')).toMatchObject({ invoice_id: inv });
  });

  it('room.blocked / room.unblocked', async () => {
    const blockId = (
      await request(http)
        .post('/api/v1/room-blocks')
        .set(auth())
        .send({ room_id: roomA, start_at: '2027-12-01T00:00:00.000Z', end_at: '2027-12-05T00:00:00.000Z', reason: 'Bảo trì' })
        .expect(201)
    ).body.data.id as string;
    expect(await findEvent(blockId, 'room.blocked')).toMatchObject({ property_id: propertyId, room_id: roomA, block_id: blockId });

    await request(http).delete(`/api/v1/room-blocks/${blockId}`).set(auth()).expect(204);
    expect(await findEvent(blockId, 'room.unblocked')).toMatchObject({ property_id: propertyId, room_id: roomA, block_id: blockId });
  });
});
