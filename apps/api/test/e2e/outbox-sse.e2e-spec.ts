import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type AddressInfo } from 'node:net';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type OutboxPublishInput, type RealtimeEvent } from '@pms/shared-types';
import type Redis from 'ioredis';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OutboxDispatcher } from '@core/outbox/outbox.dispatcher';
import { OutboxService } from '@core/outbox/outbox.service';
import { PrismaService } from '@core/prisma/prisma.service';
import { REDIS } from '@core/redis/redis.module';
import { withTenant } from '@core/tenancy/with-tenant';
import { EventBusService } from '@modules/events/event-bus.service';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance task 4.2 (docs/10 §3/§4/§9): Transactional Outbox v2 + SSE.
 *   - publish trong tx rollback → KHÔNG event (atomic)
 *   - publish commit → PENDING (tenant_id từ context); kick → PROCESSED + fan-out Redis (event_id)
 *   - SSE /events/stream: client HTTP nhận event; thiếu/sai token → 401; query access_token OK
 *   - SKIP LOCKED: 2 claim đồng thời tập rời nhau (multi-instance không double-send)
 *   - reclaim: PROCESSING kẹt >60s → PENDING + retry++
 *   - dispatch lỗi 10 lần → FAILED + retry_count=10
 *
 * ENABLE_SCHEDULERS=false (ép ở test/setup) → dispatcher KHÔNG tự LISTEN/poll; gọi
 * kick()/reclaim() trực tiếp. EventBus subscribe Redis (db 1 test) luôn chạy.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `ob-${RUN}`;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Chờ tới khi predicate đúng (poll) — fan-out Redis pub/sub là bất đồng bộ. */
async function waitFor(predicate: () => boolean, timeoutMs = 3000, stepMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(stepMs);
  }
  throw new Error('waitFor: hết thời gian chờ');
}

/** Đọc 1 data-event SSE đầu tiên (bỏ qua heartbeat 'ping'). */
async function readSseEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<RealtimeEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('SSE timeout: không nhận được data event')), timeoutMs);
  });
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) throw new Error('SSE stream đóng sớm');
      buffer += decoder.decode(chunk.value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const lines = frame.split('\n');
        if (lines.some((l) => l.startsWith('event:') && l.includes('ping'))) continue; // heartbeat
        const dataLine = lines.find((l) => l.startsWith('data:'));
        if (dataLine) return JSON.parse(dataLine.replace(/^data:\s*/, '')) as RealtimeEvent;
      }
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe('Outbox v2 + SSE (task 4.2)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let port: number;
  let admin: Client;
  let token: string;
  let tenantId: string;
  let propertyId: string;

  let prisma: PrismaService;
  let outbox: OutboxService;
  let dispatcher: OutboxDispatcher;
  let eventBus: EventBusService;
  let redis: Redis;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const publish = (input: OutboxPublishInput): Promise<void> =>
    withTenant(prisma, tenantId, (tx) => outbox.publish(tx, input));

  const rowByAgg = async (aggId: string) =>
    (
      await admin.query(
        `SELECT id, status, tenant_id, retry_count, last_error, processed_at FROM outbox_events WHERE aggregate_id = $1`,
        [aggId],
      )
    ).rows[0] as
      | { id: string; status: string; tenant_id: string; retry_count: number; last_error: string | null; processed_at: Date | null }
      | undefined;

  const rowById = async (id: string) =>
    (await admin.query(`SELECT status, retry_count, last_error FROM outbox_events WHERE id = $1`, [id])).rows[0] as {
      status: string;
      retry_count: number;
      last_error: string | null;
    };

  beforeAll(async () => {
    const env = loadEnv();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.listen(0); // cần port thật cho fetch SSE (stream dài)
    http = app.getHttpServer();
    port = (http.address() as AddressInfo).port;

    prisma = app.get(PrismaService);
    outbox = app.get(OutboxService);
    dispatcher = app.get(OutboxDispatcher);
    eventBus = app.get(EventBusService);
    redis = app.get<Redis>(REDIS);

    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();

    await request(http)
      .post('/api/v1/auth/register')
      .send({ tenant_slug: tenantSlug, tenant_display_name: 'Outbox E2E', email: `owner-${RUN}@e2e.test`, password: PASSWORD, full_name: 'Owner' })
      .expect(201);
    token = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: `owner-${RUN}@e2e.test`, password: PASSWORD }).expect(200)
    ).body.data.access_token;
    propertyId = (
      await request(http).post('/api/v1/properties').set(auth()).send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' }).expect(201)
    ).body.data.id;
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id as string;
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await app?.close();
  });

  it('publish trong tx ROLLBACK → KHÔNG có event (atomic)', async () => {
    const aggId = randomUUID();
    await expect(
      withTenant(prisma, tenantId, async (tx) => {
        await outbox.publish(tx, { event_type: 'booking.created', aggregate_type: 'booking', aggregate_id: aggId, payload: { property_id: propertyId } });
        throw new Error('boom rollback');
      }),
    ).rejects.toThrow('boom rollback');
    expect(await rowByAgg(aggId)).toBeUndefined();
  });

  it('publish commit → PENDING (tenant_id từ context); kick → PROCESSED + fan-out Redis kèm event_id', async () => {
    const aggId = randomUUID();
    const received: RealtimeEvent[] = [];
    const subscription = eventBus.forTenant(tenantId).subscribe((e) => received.push(e));
    await eventBus.whenSubscribed(); // subscriber Redis sẵn sàng trước khi publish (lazy)

    await publish({ event_type: 'booking.created', aggregate_type: 'booking', aggregate_id: aggId, payload: { property_id: propertyId, booking_id: aggId } });

    const pending = await rowByAgg(aggId);
    expect(pending?.status).toBe('PENDING');
    expect(pending?.tenant_id).toBe(tenantId); // suy từ current_setting trong tenant-tx

    const dispatched = await dispatcher.kick();
    expect(dispatched).toBeGreaterThanOrEqual(1);
    expect((await rowById(pending!.id)).status).toBe('PROCESSED');

    await waitFor(() => received.some((e) => e.event_id === pending!.id));
    const msg = received.find((e) => e.event_id === pending!.id)!;
    expect(msg.event_type).toBe('booking.created');
    expect(msg.payload.property_id).toBe(propertyId);
    subscription.unsubscribe();
  });

  it('SSE /events/stream (HTTP): client nhận đúng event; payload có property_id', async () => {
    const aggId = randomUUID();
    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/events/stream`, { headers: { Authorization: `Bearer ${token}` }, signal: ac.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();

    await eventBus.whenSubscribed(); // subscriber Redis sẵn sàng (lazy mở khi handler gọi forTenant)
    await sleep(150); // cho NestJS kịp subscribe Observable trước khi publish (tránh đua)
    const t0 = Date.now();
    await publish({ event_type: 'payment.received', aggregate_type: 'payment', aggregate_id: aggId, payload: { property_id: propertyId, invoice_id: aggId } });
    await dispatcher.kick();

    const event = await readSseEvent(reader, 5000);
    const latency = Date.now() - t0;
    expect(event.event_type).toBe('payment.received');
    expect(event.payload.invoice_id).toBe(aggId);
    expect(event.event_id).toBeTruthy();
    // docs/10 §9 mục tiêu p95 < 500ms (đường NOTIFY). Test gọi kick() trực tiếp nên
    // thường < 100ms — nới biên để không flaky dưới contention maxForks=2.
    expect(latency).toBeLessThan(2000);

    ac.abort();
    await reader.cancel().catch(() => undefined);
  });

  it('SSE auth: thiếu token → 401; token sai → 401; ?access_token hợp lệ → 200 stream', async () => {
    const noTok = await fetch(`http://127.0.0.1:${port}/api/v1/events/stream`);
    expect(noTok.status).toBe(401);
    await noTok.body?.cancel().catch(() => undefined);

    const badTok = await fetch(`http://127.0.0.1:${port}/api/v1/events/stream?access_token=garbage`);
    expect(badTok.status).toBe(401);
    await badTok.body?.cancel().catch(() => undefined);

    // EventSource native không gửi được header → token qua query param
    const ac = new AbortController();
    const okQuery = await fetch(`http://127.0.0.1:${port}/api/v1/events/stream?access_token=${token}`, { signal: ac.signal });
    expect(okQuery.status).toBe(200);
    expect(okQuery.headers.get('content-type')).toContain('text/event-stream');
    ac.abort();
    await okQuery.body?.cancel().catch(() => undefined);
  });

  it('SKIP LOCKED: 2 claim đồng thời lấy tập RỜI NHAU (multi-instance không double-send)', async () => {
    const aggIds: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const aggId = randomUUID();
      await publish({ event_type: 'room.housekeeping_changed', aggregate_type: 'room', aggregate_id: aggId, payload: { property_id: propertyId, n: i } });
      aggIds.push(aggId);
    }

    const [batchA, batchB] = await Promise.all([outbox.claimBatch(3), outbox.claimBatch(3)]);
    const idsA = new Set(batchA.map((e) => e.id));
    const overlap = batchB.filter((e) => idsA.has(e.id));
    expect(overlap).toHaveLength(0); // không row nào bị claim 2 lần

    // dọn (markProcessed) để không ảnh hưởng test sau
    for (const e of [...batchA, ...batchB]) await outbox.markProcessed(e.id);
  });

  it('reclaim: PROCESSING kẹt > 60s (worker crash) → PENDING + retry_count++', async () => {
    const aggId = randomUUID();
    await publish({ event_type: 'invoice.overdue', aggregate_type: 'invoice', aggregate_id: aggId, payload: { property_id: propertyId } });
    const id = (await rowByAgg(aggId))!.id;
    await admin.query(`UPDATE outbox_events SET status = 'PROCESSING', claimed_at = now() - interval '120 seconds' WHERE id = $1`, [id]);

    const reclaimed = await dispatcher.reclaim();
    expect(reclaimed).toBeGreaterThanOrEqual(1);
    const after = await rowById(id);
    expect(after.status).toBe('PENDING');
    expect(after.retry_count).toBe(1);

    await outbox.markProcessed(id); // dọn
  });

  it('dispatch lỗi 10 lần (Redis publish fail) → FAILED + retry_count=10', async () => {
    const aggId = randomUUID();
    await publish({ event_type: 'booking.created', aggregate_type: 'booking', aggregate_id: aggId, payload: { property_id: propertyId } });
    const id = (await rowByAgg(aggId))!.id;

    const spy = vi.spyOn(redis, 'publish').mockRejectedValue(new Error('redis down'));
    try {
      for (let i = 0; i < 10; i += 1) await dispatcher.kick();
    } finally {
      spy.mockRestore();
    }

    const after = await rowById(id);
    expect(after.status).toBe('FAILED');
    expect(after.retry_count).toBe(10);
    expect(after.last_error).toContain('redis down');
  });
});
