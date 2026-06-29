import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance task 4.4 (docs/10 §7): outbox dispatcher enqueue → worker route theo
 * role/property × kênh → ghi notifications (idempotent) + side-effect. ENABLE_SCHEDULERS
 * =false → gọi NotificationsService.processEvent trực tiếp (như reconcile/night-audit).
 *   - payment.received → IN_APP + EMAIL (email tới Mailpit); chạy lại idempotent
 *   - booking.checked_in → chỉ IN_APP
 *   - REST inbox: GET /notifications (unread) + POST /:id/read
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `noti-${RUN}`;
const OWNER_EMAIL = `owner-${RUN}@e2e.test`;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Mailpit API (dev stack) — chờ email mới nhất gửi tới `to` (subject + text + html). */
async function waitMailpit(
  to: string,
  timeoutMs = 4000,
): Promise<{ subject: string; text: string; html: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = (await fetch('http://localhost:8025/api/v1/messages?limit=30').then((r) => r.json())) as {
      messages?: { ID: string; To: { Address: string }[] }[];
    };
    const found = list.messages?.find((m) => m.To.some((t) => t.Address === to));
    if (found) {
      const msg = (await fetch(`http://localhost:8025/api/v1/message/${found.ID}`).then((r) => r.json())) as {
        Subject: string;
        Text: string;
        HTML: string;
      };
      return { subject: msg.Subject, text: msg.Text, html: msg.HTML };
    }
    await sleep(150);
  }
  throw new Error(`Không thấy email gửi tới ${to} trong Mailpit`);
}

describe('Notifications (task 4.4)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let tenantId: string;
  let propertyId: string;
  let notifications: NotificationsService;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const channelsByEvent = async (eventId: string): Promise<string[]> =>
    (
      await admin.query(`SELECT channel FROM notifications WHERE tenant_id = $1 AND event_id = $2 ORDER BY channel`, [tenantId, eventId])
    ).rows.map((r) => r.channel as string);

  beforeAll(async () => {
    const env = loadEnv();
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
      .send({ tenant_slug: tenantSlug, tenant_display_name: 'NOTI', email: OWNER_EMAIL, password: PASSWORD, full_name: 'Owner' })
      .expect(201);
    token = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: OWNER_EMAIL, password: PASSWORD }).expect(200)
    ).body.data.access_token;
    propertyId = (
      await request(http).post('/api/v1/properties').set(auth()).send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' }).expect(201)
    ).body.data.id;
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id as string;
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM notifications WHERE tenant_id IN ${tid}`);
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

  it('payment.received → OWNER nhận IN_APP + EMAIL (Mailpit); chạy lại idempotent', async () => {
    const eventId = randomUUID();
    const event = {
      event_id: eventId,
      event_type: 'payment.received',
      tenant_id: tenantId,
      payload: { property_id: propertyId, payment_id: randomUUID(), invoice_id: randomUUID() },
    };
    const r1 = await notifications.processEvent(event);
    expect(r1.delivered).toBe(2); // IN_APP + EMAIL cho OWNER
    expect(await channelsByEvent(eventId)).toEqual(['EMAIL', 'IN_APP']);

    // Email thật tới Mailpit — B2: có HTML thương hiệu + text fallback.
    const mail = await waitMailpit(OWNER_EMAIL);
    expect(mail.subject).toContain('Nhận thanh toán');
    expect(mail.html.toLowerCase()).toContain('<!doctype html'); // email HTML
    expect(mail.html).toContain('Nhận thanh toán'); // tiêu đề trong HTML
    expect(mail.html).toContain('PMS Homestay'); // header thương hiệu
    expect(mail.text).toContain('PMS Homestay'); // text fallback vẫn còn

    // Chạy lại cùng event → ON CONFLICT DO NOTHING → không ghi đôi
    const r2 = await notifications.processEvent(event);
    expect(r2.delivered).toBe(0);
    expect(await channelsByEvent(eventId)).toHaveLength(2);
  });

  it('booking.checked_in → chỉ IN_APP (không email)', async () => {
    const eventId = randomUUID();
    const r = await notifications.processEvent({
      event_id: eventId,
      event_type: 'booking.checked_in',
      tenant_id: tenantId,
      payload: { property_id: propertyId, booking_id: randomUUID() },
    });
    expect(r.delivered).toBe(1);
    expect(await channelsByEvent(eventId)).toEqual(['IN_APP']);
  });

  it('REST: GET /notifications (inbox in-app) + POST /:id/read', async () => {
    // tạo 1 in-app noti qua processEvent
    await notifications.processEvent({
      event_id: randomUUID(),
      event_type: 'booking.created',
      tenant_id: tenantId,
      payload: { property_id: propertyId, booking_id: randomUUID() },
    });

    const unread = (await request(http).get('/api/v1/notifications?unread_only=true').set(auth()).expect(200)).body.data as {
      id: string;
      channel: string;
      is_read: boolean;
    }[];
    expect(unread.length).toBeGreaterThanOrEqual(1);
    expect(unread.every((n) => n.channel === 'IN_APP' && !n.is_read)).toBe(true);

    const first = unread[0]!;
    const read = (await request(http).post(`/api/v1/notifications/${first.id}/read`).set(auth()).expect(200)).body.data as {
      is_read: boolean;
    };
    expect(read.is_read).toBe(true);

    // sau khi đọc → không còn trong danh sách unread
    const afterRead = (await request(http).get('/api/v1/notifications?unread_only=true').set(auth()).expect(200)).body.data as {
      id: string;
    }[];
    expect(afterRead.some((n) => n.id === first.id)).toBe(false);
  });
});
