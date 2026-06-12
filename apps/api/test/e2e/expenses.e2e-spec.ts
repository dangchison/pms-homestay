import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExpensesService } from '@modules/expenses/expenses.service';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance task 3.6 (docs/03 §4.7, docs/09 §6): CRUD chi phí (cấm nhập tay
 * OTA_COMMISSION; định kỳ cần pattern); booking CHECKED_OUT → auto-sinh
 * OTA_COMMISSION từ commission_vnd (đúng 1 lần, partial unique); commission 0 →
 * không sinh; generateRecurringExpenses sinh child kỳ sau từ template, idempotent.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `exp-${RUN}`;

describe('Operational expenses + OTA commission (task 3.6)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let propertyId: string;
  let tenantId: string;
  let resA: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const createExpense = async (body: Record<string, unknown>) =>
    (await request(http).post('/api/v1/expenses').set(auth()).send(body).expect(201)).body.data;

  const quote = async (ci: string, co: string): Promise<string> =>
    (
      await request(http)
        .post('/api/v1/pricing/quote')
        .set(auth())
        .send({ resource_id: resA, mode: 'DAILY', check_in: ci, check_out: co })
        .expect(200)
    ).body.data.quote_id;

  const book = async (ci: string, co: string): Promise<string> =>
    (
      await request(http)
        .post('/api/v1/bookings')
        .set({ ...auth(), 'Idempotency-Key': randomUUID() })
        .send({ resource_id: resA, quote_id: await quote(ci, co), mode: 'DAILY', check_in: ci, check_out: co })
        .expect(201)
    ).body.data.id;

  /** book → force CONFIRMED → CHECKED_IN (sẵn sàng check-out). */
  const bookToCheckedIn = async (ci: string, co: string): Promise<string> => {
    const id = await book(ci, co);
    await request(http).post(`/api/v1/bookings/${id}/confirm`).set(auth()).send({ force: true }).expect(200);
    await request(http).post(`/api/v1/bookings/${id}/check-in`).set(auth()).expect(200);
    return id;
  };

  const childCount = async (parentId: string): Promise<number> =>
    (await admin.query(`SELECT count(*)::int n FROM operational_expenses WHERE parent_expense_id = $1`, [parentId]))
      .rows[0].n;

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
        tenant_display_name: 'EXP E2E',
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
    const roomId = (
      await request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: '101' }).expect(201)
    ).body.data.id;
    resA = (
      await request(http).get(`/api/v1/bookable-resources?property_id=${propertyId}`).set(auth()).expect(200)
    ).body.data.find((r: { room_ids: string[] }) => r.room_ids.includes(roomId)).id;
    await request(http)
      .post('/api/v1/rate-plans')
      .set(auth())
      .send({
        property_id: propertyId,
        name: 'DAILY NONE',
        mode: 'DAILY',
        base_price_vnd: 500_000,
        effective_from: '2026-01-01',
        deposit_type: 'NONE',
        resource_ids: [resA],
      })
      .expect(201);

    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id as string;
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
      // child trước (self-FK parent_expense_id), rồi toàn bộ chi phí
      await admin.query(`DELETE FROM operational_expenses WHERE tenant_id IN ${tid} AND parent_expense_id IS NOT NULL`);
      await admin.query(`DELETE FROM operational_expenses WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM payment_attempts WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM payments WHERE tenant_id IN ${tid}`);
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

  it('CRUD + chặn OTA_COMMISSION nhập tay + chặn recurring thiếu pattern', async () => {
    const e = await createExpense({
      property_id: propertyId,
      expense_type: 'ELECTRICITY',
      description: 'Tiền điện T1',
      amount_vnd: 1_200_000,
      expense_date: '2026-01-31',
    });
    expect(e.expense_type).toBe('ELECTRICITY');
    expect(e.is_paid).toBe(false);
    expect(e.is_recurring).toBe(false);

    const got = (await request(http).get(`/api/v1/expenses/${e.id}`).set(auth()).expect(200)).body.data;
    expect(got.amount_vnd).toBe(1_200_000);

    const list = (
      await request(http)
        .get(`/api/v1/expenses?property_id=${propertyId}&expense_type=ELECTRICITY`)
        .set(auth())
        .expect(200)
    ).body;
    expect(list.data.some((x: { id: string }) => x.id === e.id)).toBe(true);

    const upd = (
      await request(http)
        .patch(`/api/v1/expenses/${e.id}`)
        .set(auth())
        .send({ is_paid: true, paid_at: '2026-02-01T00:00:00.000Z', amount_vnd: 1_250_000 })
        .expect(200)
    ).body.data;
    expect(upd.is_paid).toBe(true);
    expect(upd.amount_vnd).toBe(1_250_000);

    await request(http).delete(`/api/v1/expenses/${e.id}`).set(auth()).expect(204);
    await request(http).get(`/api/v1/expenses/${e.id}`).set(auth()).expect(404);

    // OTA_COMMISSION nhập tay → 400
    const bad1 = await request(http)
      .post('/api/v1/expenses')
      .set(auth())
      .send({ property_id: propertyId, expense_type: 'OTA_COMMISSION', amount_vnd: 1000, expense_date: '2026-01-01' });
    expect(bad1.status).toBe(400);

    // recurring thiếu recurrence_pattern → 400
    const bad2 = await request(http)
      .post('/api/v1/expenses')
      .set(auth())
      .send({
        property_id: propertyId,
        expense_type: 'MARKETING',
        amount_vnd: 1000,
        expense_date: '2026-01-01',
        is_recurring: true,
      });
    expect(bad2.status).toBe(400);
  });

  it('★ check-out → auto-sinh OTA_COMMISSION từ commission_vnd (đúng 1 dòng)', async () => {
    const id = await bookToCheckedIn('2027-05-01T07:00:00.000Z', '2027-05-03T05:00:00.000Z');
    // mô phỏng booking OTA: gán commission (thực tế do iCal/Channex sync set)
    await admin.query(`UPDATE bookings SET commission_vnd = 150000 WHERE id = $1`, [id]);
    await request(http).post(`/api/v1/bookings/${id}/check-out`).set(auth()).expect(200);

    const list = (
      await request(http)
        .get(`/api/v1/expenses?property_id=${propertyId}&expense_type=OTA_COMMISSION`)
        .set(auth())
        .expect(200)
    ).body.data as Array<{ source_booking_id: string; amount_vnd: number; expense_type: string }>;
    const ota = list.filter((x) => x.source_booking_id === id);
    expect(ota).toHaveLength(1);
    expect(ota[0]!.amount_vnd).toBe(150_000);
    expect(ota[0]!.expense_type).toBe('OTA_COMMISSION');
  });

  it('check-out không commission (=0) → KHÔNG sinh OTA expense', async () => {
    const id = await bookToCheckedIn('2027-06-01T07:00:00.000Z', '2027-06-03T05:00:00.000Z');
    await request(http).post(`/api/v1/bookings/${id}/check-out`).set(auth()).expect(200);
    const n = (
      await admin.query(
        `SELECT count(*)::int n FROM operational_expenses WHERE source_booking_id = $1 AND expense_type = 'OTA_COMMISSION'`,
        [id],
      )
    ).rows[0].n;
    expect(n).toBe(0);
  });

  it('★ sinh chi phí định kỳ MONTHLY → child kỳ sau; idempotent; tháng neo không sinh', async () => {
    const tmpl = await createExpense({
      property_id: propertyId,
      expense_type: 'RENT_LANDLORD',
      description: 'Thuê nhà',
      amount_vnd: 5_000_000,
      expense_date: '2026-01-05',
      is_recurring: true,
      recurrence_pattern: 'MONTHLY',
    });
    const svc = app.get(ExpensesService);

    // tháng neo (2026-01): template ĐÃ là chi phí của nó → không sinh child
    await svc.generateRecurringExpenses(tenantId, 2026, 1);
    expect(await childCount(tmpl.id)).toBe(0);

    // 2026-02 → 1 child
    const r2 = await svc.generateRecurringExpenses(tenantId, 2026, 2);
    expect(r2.expenses_created).toBeGreaterThanOrEqual(1);
    expect(await childCount(tmpl.id)).toBe(1);

    // chạy lại 2026-02 → idempotent, không sinh thêm
    await svc.generateRecurringExpenses(tenantId, 2026, 2);
    expect(await childCount(tmpl.id)).toBe(1);

    // child: ngày 2026-02-05 (kẹp theo ngày template), 5tr, KHÔNG recurring
    const child = (
      await admin.query(
        `SELECT to_char(expense_date,'YYYY-MM-DD') d, amount_vnd::text amt, is_recurring r
         FROM operational_expenses WHERE parent_expense_id = $1`,
        [tmpl.id],
      )
    ).rows[0];
    expect(child.d).toBe('2026-02-05');
    expect(child.amt).toBe('5000000');
    expect(child.r).toBe(false);
  });
});
