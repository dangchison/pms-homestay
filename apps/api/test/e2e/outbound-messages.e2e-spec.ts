import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NightAuditService } from '@modules/night-audit/night-audit.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance Đợt 4 / M1 (docs/18): NotificationChannelProvider + Mock ZNS/SMS +
 * bảng outbound_messages. Chạy mock/sandbox theo env — KHÔNG cần creds thật.
 *   (1) processEvent(ForChannels) route SMS/ZNS với SMS_PROVIDER=mock & ZNS_PROVIDER=mock
 *       → ghi outbound_messages status='SENT', provider_message_id khớp /^mock-/;
 *   (2) EMAIL cùng flow vẫn tới Mailpit (không hồi quy notifications.e2e-spec);
 *   (3) REST GET /api/v1/notifications/outbound (perm audit_log.read) + ?channel + ?limit;
 *   (4) RLS interleaved: tenant A/B ghi xen kẽ, mỗi token chỉ thấy dữ liệu tenant mình;
 *   (5) mode 'log' (SMS_PROVIDER=log & ZNS_PROVIDER=log qua AppModule.forRoot override)
 *       giữ hành vi cũ không throw + ghi outbound provider='log', provider_message_id=NULL;
 *   (6) retention: dòng created_at > 90 ngày bị night-audit cleanupRetention xoá, dòng mới còn.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Mailpit API (dev stack) — chờ email mới nhất gửi tới `to`. */
async function waitMailpit(to: string, timeoutMs = 4000): Promise<{ subject: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = (await fetch('http://localhost:8025/api/v1/messages?limit=50').then((r) => r.json())) as {
      messages?: { ID: string; To: { Address: string }[] }[];
    };
    const found = list.messages?.find((m) => m.To.some((t) => t.Address === to));
    if (found) {
      const msg = (await fetch(`http://localhost:8025/api/v1/message/${found.ID}`).then((r) => r.json())) as {
        Subject: string;
      };
      return { subject: msg.Subject };
    }
    await sleep(150);
  }
  throw new Error(`Không thấy email gửi tới ${to} trong Mailpit`);
}

interface Tenant {
  slug: string;
  ownerEmail: string;
  token: string;
  tenantId: string;
  propertyId: string;
}

describe('Outbound messages (Đợt 4 / M1)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let notifications: NotificationsService;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** register + login + tạo property → 1 tenant OWNER dùng cho test. */
  async function makeTenant(label: string): Promise<Tenant> {
    const slug = `outb-${label}-${RUN}`;
    const ownerEmail = `owner-${label}-${RUN}@e2e.test`;
    await request(http)
      .post('/api/v1/auth/register')
      .send({ tenant_slug: slug, tenant_display_name: `OUT-${label}`, email: ownerEmail, password: PASSWORD, full_name: 'Owner' })
      .expect(201);
    const token = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', slug).send({ email: ownerEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token as string;
    const propertyId = (
      await request(http).post('/api/v1/properties').set(auth(token)).send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' }).expect(201)
    ).body.data.id as string;
    const tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [slug])).rows[0].id as string;
    return { slug, ownerEmail, token, tenantId, propertyId };
  }

  const outboundRows = async (tenantId: string): Promise<{ channel: string; provider: string; provider_message_id: string | null; status: string }[]> =>
    (
      await admin.query(
        `SELECT channel, provider, provider_message_id, status FROM outbound_messages WHERE tenant_id = $1 ORDER BY created_at`,
        [tenantId],
      )
    ).rows;

  let a: Tenant;
  let b: Tenant;

  beforeAll(async () => {
    // Block chính chạy với provider mock (mặc định); set tường minh cho rõ ý định.
    process.env.SMS_PROVIDER = 'mock';
    process.env.ZNS_PROVIDER = 'mock';
    const env = loadEnv();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    notifications = app.get(NotificationsService);
    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();

    a = await makeTenant('a');
    b = await makeTenant('b');
  });

  afterAll(async () => {
    if (admin) {
      for (const slug of [a?.slug, b?.slug].filter(Boolean)) {
        const tid = `(SELECT id FROM tenants WHERE slug = '${slug}')`;
        await admin.query(`DELETE FROM outbound_messages WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM notifications WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
        // night-audit (retention test) rollup tạo daily_property_stats → xoá trước properties (FK)
        await admin.query(`DELETE FROM daily_property_stats WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM tenants WHERE slug = $1`, [slug]);
      }
      await admin.end();
    }
    await app?.close();
  });

  it('(1)+(2) mock: SMS/ZNS ghi outbound SENT + id mock-<uuid>; EMAIL tới Mailpit', async () => {
    const eventId = randomUUID();
    const event = {
      event_id: eventId,
      event_type: 'payment.received', // route ra EMAIL (channelsFor) → Mailpit
      tenant_id: a.tenantId,
      payload: { property_id: a.propertyId, payment_id: randomUUID(), invoice_id: randomUUID() },
    };
    // EMAIL + IN_APP theo channelsFor → OWNER nhận 2 dòng notifications
    const r = await notifications.processEvent(event);
    expect(r.delivered).toBe(2);
    // EMAIL thật tới Mailpit (không hồi quy)
    await waitMailpit(a.ownerEmail);

    // Ép kênh SMS + ZNS cho cùng recipients (channelsFor chưa route SMS/ZNS)
    const rc = await notifications.processEventForChannels(event, ['SMS', 'ZNS']);
    expect(rc.delivered).toBe(2); // OWNER × {SMS, ZNS}

    const rows = await outboundRows(a.tenantId);
    const sms = rows.filter((x) => x.channel === 'SMS');
    const zns = rows.filter((x) => x.channel === 'ZNS');
    expect(sms.length).toBeGreaterThanOrEqual(1);
    expect(zns.length).toBeGreaterThanOrEqual(1);
    for (const x of [...sms, ...zns]) {
      expect(x.status).toBe('SENT');
      expect(x.provider).toBe('mock');
      expect(x.provider_message_id).toMatch(/^mock-/);
    }
    // EMAIL cũng đi qua registry (SmtpEmailProvider) → ghi outbound provider='smtp',
    // status='SENT', provider_message_id=NULL (SMTP không trả id ổn định).
    const email = rows.filter((x) => x.channel === 'EMAIL');
    expect(email.length).toBeGreaterThanOrEqual(1);
    for (const x of email) {
      expect(x.provider).toBe('smtp');
      expect(x.status).toBe('SENT');
      expect(x.provider_message_id).toBeNull();
    }
  });

  it('(3) REST GET /notifications/outbound (audit_log.read) + ?channel + ?limit', async () => {
    // đảm bảo có dữ liệu SMS/ZNS cho tenant a (idempotent nếu chạy sau test 1)
    await notifications.processEventForChannels(
      { event_id: randomUUID(), event_type: 'booking.created', tenant_id: a.tenantId, payload: { property_id: a.propertyId } },
      ['SMS', 'ZNS'],
    );

    const all = (await request(http).get('/api/v1/notifications/outbound').set(auth(a.token)).expect(200)).body.data as {
      id: string;
      channel: string;
      provider: string;
      provider_message_id: string | null;
      recipient: string;
      title: string;
      status: string;
      created_at: string;
    }[];
    expect(all.length).toBeGreaterThanOrEqual(2);
    for (const item of all) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('created_at');
      expect(['SMS', 'ZNS', 'EMAIL']).toContain(item.channel);
    }

    // ?channel=SMS lọc đúng
    const smsOnly = (await request(http).get('/api/v1/notifications/outbound?channel=SMS').set(auth(a.token)).expect(200)).body.data as { channel: string }[];
    expect(smsOnly.length).toBeGreaterThanOrEqual(1);
    expect(smsOnly.every((x) => x.channel === 'SMS')).toBe(true);

    // ?limit=1 phân trang
    const limited = (await request(http).get('/api/v1/notifications/outbound?limit=1').set(auth(a.token)).expect(200)).body.data as unknown[];
    expect(limited).toHaveLength(1);
  });

  it('(4) RLS interleaved: A/B ghi xen kẽ → mỗi token chỉ thấy tenant mình', async () => {
    // Ghi xen kẽ A,B,A,B qua processEventForChannels (mỗi lần ≥1 dòng/kênh)
    const evA1 = { event_id: randomUUID(), event_type: 'booking.created', tenant_id: a.tenantId, payload: { property_id: a.propertyId } };
    const evB1 = { event_id: randomUUID(), event_type: 'booking.created', tenant_id: b.tenantId, payload: { property_id: b.propertyId } };
    const evA2 = { event_id: randomUUID(), event_type: 'booking.cancelled', tenant_id: a.tenantId, payload: { property_id: a.propertyId } };
    const evB2 = { event_id: randomUUID(), event_type: 'booking.cancelled', tenant_id: b.tenantId, payload: { property_id: b.propertyId } };
    await notifications.processEventForChannels(evA1, ['SMS']);
    await notifications.processEventForChannels(evB1, ['SMS']);
    await notifications.processEventForChannels(evA2, ['ZNS']);
    await notifications.processEventForChannels(evB2, ['ZNS']);

    // Token A chỉ thấy dòng tenant A
    const listA = (await request(http).get('/api/v1/notifications/outbound').set(auth(a.token)).expect(200)).body.data as { id: string }[];
    const idsA = new Set(listA.map((x) => x.id));
    // Token B chỉ thấy dòng tenant B
    const listB = (await request(http).get('/api/v1/notifications/outbound').set(auth(b.token)).expect(200)).body.data as { id: string }[];
    const idsB = new Set(listB.map((x) => x.id));

    expect(idsA.size).toBeGreaterThanOrEqual(1);
    expect(idsB.size).toBeGreaterThanOrEqual(1);
    // Không giao nhau (RLS + withTenant cô lập)
    for (const id of idsA) expect(idsB.has(id)).toBe(false);

    // Đối chiếu với admin (bypass RLS): id A không nằm trong tập id của tenant B
    const dbB = new Set((await admin.query(`SELECT id FROM outbound_messages WHERE tenant_id = $1`, [b.tenantId])).rows.map((r) => r.id as string));
    for (const id of idsA) expect(dbB.has(id)).toBe(false);
  });

  it('(6) retention: dòng > 90 ngày bị night-audit xoá, dòng mới còn', async () => {
    const nightAudit = app.get(NightAuditService);
    // Chèn 1 dòng CŨ (created_at > 90 ngày) + 1 dòng MỚI qua admin (bypass RLS)
    const oldId = randomUUID();
    const freshId = randomUUID();
    await admin.query(
      `INSERT INTO outbound_messages (id, tenant_id, channel, provider, recipient, title, body, status, created_at)
       VALUES ($1, $2, 'SMS', 'mock', 'r', 't', 'b', 'SENT', now() - interval '100 days')`,
      [oldId, a.tenantId],
    );
    await admin.query(
      `INSERT INTO outbound_messages (id, tenant_id, channel, provider, recipient, title, body, status, created_at)
       VALUES ($1, $2, 'SMS', 'mock', 'r', 't', 'b', 'SENT', now())`,
      [freshId, a.tenantId],
    );

    await nightAudit.runForTenant(a.tenantId, new Date());

    const exists = async (id: string): Promise<boolean> =>
      (await admin.query(`SELECT 1 FROM outbound_messages WHERE id = $1`, [id])).rowCount === 1;
    expect(await exists(oldId)).toBe(false); // > 90 ngày → xoá
    expect(await exists(freshId)).toBe(true); // < 90 ngày → còn
  });
});

/**
 * (5) Mode 'log' backward-compatible — app RIÊNG với SMS_PROVIDER=log & ZNS_PROVIDER=log
 * qua AppModule.forRoot(env override). processEvent(ForChannels) SMS/ZNS KHÔNG throw,
 * ghi outbound provider='log', status='SENT', provider_message_id=NULL.
 */
describe("Outbound messages — mode 'log' (backward-compatible)", () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let notifications: NotificationsService;
  const slug = `outb-log-${RUN}`;
  const ownerEmail = `owner-log-${RUN}@e2e.test`;
  let tenantId: string;
  let propertyId: string;
  let token: string;

  beforeAll(async () => {
    process.env.SMS_PROVIDER = 'log';
    process.env.ZNS_PROVIDER = 'log';
    const env = loadEnv();
    expect(env.SMS_PROVIDER).toBe('log');
    expect(env.ZNS_PROVIDER).toBe('log');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    notifications = app.get(NotificationsService);
    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();

    await request(http)
      .post('/api/v1/auth/register')
      .send({ tenant_slug: slug, tenant_display_name: 'OUT-LOG', email: ownerEmail, password: PASSWORD, full_name: 'Owner' })
      .expect(201);
    token = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', slug).send({ email: ownerEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;
    propertyId = (
      await request(http).post('/api/v1/properties').set({ Authorization: `Bearer ${token}` }).send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' }).expect(201)
    ).body.data.id;
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [slug])).rows[0].id as string;
  });

  afterAll(async () => {
    // reset env cho spec khác (vitest có thể tái dùng process)
    process.env.SMS_PROVIDER = 'mock';
    process.env.ZNS_PROVIDER = 'mock';
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${slug}')`;
      await admin.query(`DELETE FROM outbound_messages WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM notifications WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM daily_property_stats WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [slug]);
      await admin.end();
    }
    await app?.close();
  });

  it("mode 'log': SMS/ZNS KHÔNG throw + ghi outbound provider='log', id=NULL", async () => {
    const event = {
      event_id: randomUUID(),
      event_type: 'booking.created',
      tenant_id: tenantId,
      payload: { property_id: propertyId },
    };
    const r = await notifications.processEventForChannels(event, ['SMS', 'ZNS']);
    expect(r.delivered).toBe(2);

    const rows = (
      await admin.query(`SELECT channel, provider, provider_message_id, status FROM outbound_messages WHERE tenant_id = $1`, [tenantId])
    ).rows as { channel: string; provider: string; provider_message_id: string | null; status: string }[];
    expect(rows.length).toBe(2);
    for (const x of rows) {
      expect(x.provider).toBe('log');
      expect(x.status).toBe('SENT');
      expect(x.provider_message_id).toBeNull();
    }
  });
});
