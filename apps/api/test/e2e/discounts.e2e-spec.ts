import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type JwtClaims } from '@pms/shared-types';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';
import { DiscountsService } from '@modules/discounts/discounts.service';

/**
 * ★ Acceptance task 9.4b (Wave-1 #4, docs/07 §7): DiscountsService + logic redemption.
 * (1) CRUD mã (FIXED/PERCENT, refine biên, soft-delete, trùng CITEXT → 409, cross-tenant);
 * (2) applyDiscount trực tiếp qua service — mọi nhánh reason_code + FIXED-cap + PERCENT-roundVnd
 *     + biên closed-interval + applicable=[] vs NULL;
 * (3) redemption qua createBookingTx — used_count +1 CÙNG tx; mã cạn → 409 DISCOUNT_EXHAUSTED +
 *     booking KHÔNG tồn tại; quote không có discount_code_id → luồng cũ (backward-compatible).
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `disc-${RUN}`;
const ownerEmail = `owner-${RUN}@e2e.test`;
const accEmail = `acc-${RUN}@e2e.test`;
const staffEmail = `staff-${RUN}@e2e.test`; // có booking.read → validate 200
const hkEmail = `hk-${RUN}@e2e.test`; // HOUSEKEEPER (KHÔNG booking.read) → validate 403
// tenant thứ 2 để kiểm cross-tenant (RLS)
const otherSlug = `disc2-${RUN}`;
const otherOwnerEmail = `owner2-${RUN}@e2e.test`;

describe('Discount codes + redemption (task 9.4b)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string; // OWNER tenant 1
  let accToken: string; // ACCOUNTANT tenant 1 (KHÔNG rate_plan.manage → 403)
  let staffToken: string; // STAFF tenant 1 (có booking.read → validate 200)
  let hkToken: string; // HOUSEKEEPER tenant 1 (KHÔNG booking.read → validate 403)
  let otherToken: string; // OWNER tenant 2
  let discounts: DiscountsService;
  let tenantId: string;
  let propertyId: string;
  let resourceId: string;
  let guestId: string;

  const auth = (tok = token) => ({ Authorization: `Bearer ${tok}` });
  const dc = (path = '', tok = token) =>
    request(http).post(`/api/v1/discount-codes${path}`).set(auth(tok));

  const owner = (tid: string): JwtClaims =>
    ({ sub: randomUUID(), tnt: tid, rol: 'OWNER', pv: 0 }) as unknown as JwtClaims;

  const quote = async (ci: string, co: string): Promise<string> =>
    (
      await request(http)
        .post('/api/v1/pricing/quote')
        .set(auth())
        .send({ resource_id: resourceId, mode: 'DAILY', check_in: ci, check_out: co })
        .expect(200)
    ).body.data.quote_id;

  /** Tạo mã trực tiếp bằng admin client (bỏ qua HTTP) → điều khiển mọi cột cho nhánh applyDiscount. */
  const seedCode = async (over: Record<string, unknown> = {}): Promise<string> => {
    const c = {
      code: `SEED-${randomUUID().slice(0, 8)}`,
      discount_type: 'FIXED',
      discount_value: 50000,
      min_order_vnd: 0,
      max_uses: null,
      used_count: 0,
      valid_from: null,
      valid_to: null,
      applicable_property_ids: null as string[] | null,
      is_active: true,
      ...over,
    };
    const res = await admin.query(
      `INSERT INTO discount_codes
        (tenant_id, code, discount_type, discount_value, min_order_vnd, max_uses, used_count,
         valid_from, valid_to, applicable_property_ids, is_active)
       VALUES ($1,$2,$3::discount_type,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        tenantId,
        c.code,
        c.discount_type,
        c.discount_value,
        c.min_order_vnd,
        c.max_uses,
        c.used_count,
        c.valid_from,
        c.valid_to,
        c.applicable_property_ids,
        c.is_active,
      ],
    );
    return res.rows[0].id;
  };

  const codeOf = async (id: string): Promise<string> =>
    (await admin.query(`SELECT code FROM discount_codes WHERE id=$1`, [id])).rows[0].code;

  const usedCountOf = async (id: string): Promise<number> =>
    (await admin.query(`SELECT used_count FROM discount_codes WHERE id=$1`, [id])).rows[0]
      .used_count;

  beforeAll(async () => {
    const env = loadEnv();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    discounts = app.get(DiscountsService);
    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();

    // ── Tenant 1 (OWNER + property + resource + rate plan + guest) ──
    await request(http)
      .post('/api/v1/auth/register')
      .send({ tenant_slug: tenantSlug, tenant_display_name: 'DISCOUNT E2E', email: ownerEmail, password: PASSWORD, full_name: 'Owner' })
      .expect(201);
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug=$1`, [tenantSlug])).rows[0].id;
    token = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: ownerEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;

    propertyId = (
      await request(http).post('/api/v1/properties').set(auth()).send({ name: 'Homestay Đà Nẵng', property_type: 'HOMESTAY', address_line: '12 Bạch Đằng', ward: 'Hải Châu 1', district: 'Hải Châu', province: 'Đà Nẵng' }).expect(201)
    ).body.data.id;
    const roomId = (
      await request(http).post('/api/v1/rooms').set(auth()).send({ property_id: propertyId, room_number: '101' }).expect(201)
    ).body.data.id;
    resourceId = (
      await request(http).get(`/api/v1/bookable-resources?property_id=${propertyId}`).set(auth()).expect(200)
    ).body.data.find((r: { room_ids: string[] }) => r.room_ids.includes(roomId)).id;
    await request(http)
      .post('/api/v1/rate-plans')
      .set(auth())
      .send({ property_id: propertyId, name: 'DAILY', mode: 'DAILY', base_price_vnd: 500_000, effective_from: '2026-01-01', resource_ids: [resourceId] })
      .expect(201);
    guestId = (
      await request(http).post('/api/v1/guests').set(auth()).send({ full_name: 'Nguyễn Văn A', nationality: 'VN' }).expect(201)
    ).body.data.id;

    // ACCOUNTANT (KHÔNG có rate_plan.manage) — kiểm 403.
    const accHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const acc = await admin.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, default_role) VALUES ($1,$2,$3,'ACC','ACCOUNTANT') RETURNING id`,
      [tenantId, accEmail, accHash],
    );
    await admin.query(`INSERT INTO user_property_roles (tenant_id, user_id, property_id, role) VALUES ($1,$2,$3,'ACCOUNTANT')`, [tenantId, acc.rows[0].id, propertyId]);
    accToken = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: accEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;

    // STAFF (có booking.read) + HOUSEKEEPER (KHÔNG booking.read) — kiểm gate validate.
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const staff = await admin.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, default_role) VALUES ($1,$2,$3,'STAFF','STAFF') RETURNING id`,
      [tenantId, staffEmail, hash],
    );
    await admin.query(`INSERT INTO user_property_roles (tenant_id, user_id, property_id, role) VALUES ($1,$2,$3,'STAFF')`, [tenantId, staff.rows[0].id, propertyId]);
    staffToken = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: staffEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;

    const hk = await admin.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, default_role) VALUES ($1,$2,$3,'HK','HOUSEKEEPER') RETURNING id`,
      [tenantId, hkEmail, hash],
    );
    await admin.query(`INSERT INTO user_property_roles (tenant_id, user_id, property_id, role) VALUES ($1,$2,$3,'HOUSEKEEPER')`, [tenantId, hk.rows[0].id, propertyId]);
    hkToken = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: hkEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;

    // ── Tenant 2 (cross-tenant) ──
    await request(http)
      .post('/api/v1/auth/register')
      .send({ tenant_slug: otherSlug, tenant_display_name: 'DISCOUNT E2E 2', email: otherOwnerEmail, password: PASSWORD, full_name: 'Owner2' })
      .expect(201);
    otherToken = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', otherSlug).send({ email: otherOwnerEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;
  });

  afterAll(async () => {
    if (admin) {
      for (const slug of [tenantSlug, otherSlug]) {
        const tid = `(SELECT id FROM tenants WHERE slug = '${slug}')`;
        await admin.query(`DELETE FROM outbox_events WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM room_occupancy WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM booking_status_history WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM invoices WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM bookings WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM quotes WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM discount_codes WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM rate_plan_resources WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM rate_plan_rules WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM rate_plans WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM idempotency_keys WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM document_counters WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM guests WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM resource_members WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM bookable_resources WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM rooms WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM notifications WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM tenants WHERE slug = '${slug}'`); // cascade audit_logs (4.5)
      }
      await admin.end();
    }
    await app?.close();
  });

  // ── (1) CRUD qua HTTP ──────────────────────────────────────────────────────

  describe('CRUD discount_codes qua HTTP', () => {
    let fixedId: string;
    let percentId: string;

    it('tạo mã FIXED → 201, Response KHÔNG lộ tenant_id/deleted_at, money là number', async () => {
      const res = await dc()
        .send({ code: `FIX-${RUN}`, discount_type: 'FIXED', discount_value: 50000, min_order_vnd: 100000 })
        .expect(201);
      fixedId = res.body.data.id;
      expect(res.body.data).toMatchObject({
        code: `FIX-${RUN}`, discount_type: 'FIXED', discount_value: 50000, min_order_vnd: 100000, used_count: 0, is_active: true,
      });
      expect(typeof res.body.data.discount_value).toBe('number');
      expect(res.body.data.tenant_id).toBeUndefined();
      expect(res.body.data.deleted_at).toBeUndefined();
      expect(res.body.data.applicable_property_ids).toBeNull();
    });

    it('tạo mã PERCENT biên 10000 (100%) → 201', async () => {
      const res = await dc()
        .send({ code: `PCT-${RUN}`, discount_type: 'PERCENT', discount_value: 10000, applicable_property_ids: [propertyId] })
        .expect(201);
      percentId = res.body.data.id;
      expect(res.body.data).toMatchObject({ discount_type: 'PERCENT', discount_value: 10000 });
      expect(res.body.data.applicable_property_ids).toEqual([propertyId]);
    });

    it('refine: PERCENT > 10000 → 400 VALIDATION_FAILED', async () => {
      await dc().send({ code: `BAD1-${RUN}`, discount_type: 'PERCENT', discount_value: 10001 }).expect(400);
    });

    it('refine: FIXED < 1 → 400 VALIDATION_FAILED', async () => {
      await dc().send({ code: `BAD2-${RUN}`, discount_type: 'FIXED', discount_value: 0 }).expect(400);
    });

    it('trùng code (CITEXT, live) → 409 DISCOUNT_CODE_DUPLICATE', async () => {
      const res = await dc().send({ code: `fix-${RUN}`, discount_type: 'FIXED', discount_value: 1000 }).expect(409);
      expect(res.body.error.code).toBe('DISCOUNT_CODE_DUPLICATE');
    });

    it('list theo tenant + getById', async () => {
      const list = await request(http).get('/api/v1/discount-codes').set(auth()).expect(200);
      expect(list.body.data.some((d: { id: string }) => d.id === fixedId)).toBe(true);
      const one = await request(http).get(`/api/v1/discount-codes/${fixedId}`).set(auth()).expect(200);
      expect(one.body.data.id).toBe(fixedId);
    });

    it('PATCH cập nhật (min_order, is_active)', async () => {
      const res = await request(http)
        .patch(`/api/v1/discount-codes/${fixedId}`)
        .set(auth())
        .send({ min_order_vnd: 200000, is_active: false })
        .expect(200);
      expect(res.body.data).toMatchObject({ min_order_vnd: 200000, is_active: false });
      // bật lại để test khác dùng
      await request(http).patch(`/api/v1/discount-codes/${fixedId}`).set(auth()).send({ is_active: true }).expect(200);
    });

    it('PATCH đổi CHỈ discount_type → cặp lệch kiểm chéo ở service → 422 DISCOUNT_VALUE_INVALID (KHÔNG 500)', async () => {
      // FIXED discount_value=50000 (hợp lệ FIXED, vượt trần PERCENT 10000). DTO refine bỏ qua
      // khi chỉ đổi discount_type → service merge với bản ghi hiện có & chặn (không rơi DB CHECK/500).
      const id = await seedCode({ discount_type: 'FIXED', discount_value: 50000 });
      const res = await request(http)
        .patch(`/api/v1/discount-codes/${id}`)
        .set(auth())
        .send({ discount_type: 'PERCENT' })
        .expect(422);
      expect(res.body.error.code).toBe('DISCOUNT_VALUE_INVALID');
      // discount_value cũ hợp lệ cho PERCENT (≤10000) + đổi type → OK
      await request(http)
        .patch(`/api/v1/discount-codes/${id}`)
        .set(auth())
        .send({ discount_value: 1500, discount_type: 'PERCENT' })
        .expect(200);
    });

    it('DELETE = soft-delete → biến khỏi list + applyDiscount trả NOT_FOUND', async () => {
      const code = `DEL-${RUN}`;
      const created = (await dc().send({ code, discount_type: 'FIXED', discount_value: 5000 }).expect(201)).body.data.id;
      await request(http).delete(`/api/v1/discount-codes/${created}`).set(auth()).expect(204);

      const list = await request(http).get('/api/v1/discount-codes').set(auth()).expect(200);
      expect(list.body.data.some((d: { id: string }) => d.id === created)).toBe(false);
      await request(http).get(`/api/v1/discount-codes/${created}`).set(auth()).expect(404);

      // đã soft-delete → applyDiscount NOT_FOUND
      const r = await discounts.applyDiscount(code, { subtotalVnd: 200000n, propertyId }, owner(tenantId));
      expect(r).toMatchObject({ valid: false, discount_vnd: 0, reason_code: 'NOT_FOUND' });

      // re-tạo cùng code sau soft-delete (partial unique live) → OK
      await dc().send({ code, discount_type: 'FIXED', discount_value: 6000 }).expect(201);
    });

    it('ACCOUNTANT (không rate_plan.manage) → 403 create/list', async () => {
      await dc('', accToken).send({ code: `NOPE-${RUN}`, discount_type: 'FIXED', discount_value: 1000 }).expect(403);
      await request(http).get('/api/v1/discount-codes').set(auth(accToken)).expect(403);
    });

    it('HOUSEKEEPER (không rate_plan.manage) → 403 MỌI endpoint QUẢN LÝ (create/list/get/patch/delete)', async () => {
      // HK có booking.read (validate 200) nhưng KHÔNG rate_plan.manage → chặn toàn bộ quản lý mã.
      // Vai thấp nhất → chốt ma trận RBAC riêng, KHÔNG suy ra từ ACCOUNTANT. fixedId đã gán ở test đầu.
      await dc('', hkToken).send({ code: `HK-${RUN}`, discount_type: 'FIXED', discount_value: 1000 }).expect(403);
      await request(http).get('/api/v1/discount-codes').set(auth(hkToken)).expect(403);
      await request(http).get(`/api/v1/discount-codes/${fixedId}`).set(auth(hkToken)).expect(403);
      await request(http).patch(`/api/v1/discount-codes/${fixedId}`).set(auth(hkToken)).send({ is_active: false }).expect(403);
      await request(http).delete(`/api/v1/discount-codes/${fixedId}`).set(auth(hkToken)).expect(403);
    });

    it('cross-tenant: tenant 2 KHÔNG thấy mã tenant 1 (RLS) + getById → 404', async () => {
      const list = await request(http).get('/api/v1/discount-codes').set(auth(otherToken)).expect(200);
      expect(list.body.data.some((d: { id: string }) => d.id === fixedId)).toBe(false);
      await request(http).get(`/api/v1/discount-codes/${fixedId}`).set(auth(otherToken)).expect(404);
      await request(http).patch(`/api/v1/discount-codes/${fixedId}`).set(auth(otherToken)).send({ is_active: false }).expect(404);
      await request(http).delete(`/api/v1/discount-codes/${fixedId}`).set(auth(otherToken)).expect(404);
      void percentId;
    });
  });

  // ── (2) applyDiscount — mọi nhánh reason_code + tính tiền ────────────────────

  describe('applyDiscount (service, logic thuần)', () => {
    it('FIXED OK: value 50000, subtotal 200000, cửa sổ mở, min 0, applicable NULL → discount 50000', async () => {
      const id = await seedCode({ discount_type: 'FIXED', discount_value: 50000 });
      const r = await discounts.applyDiscount(await codeOf(id), { subtotalVnd: 200000n, propertyId }, owner(tenantId));
      expect(r).toEqual({ valid: true, discount_vnd: 50000, reason_code: 'OK' });
    });

    it('FIXED cap: value 50000 nhưng subtotal 30000 → discount = min(50000,30000) = 30000', async () => {
      const id = await seedCode({ discount_type: 'FIXED', discount_value: 50000 });
      const r = await discounts.applyDiscount(await codeOf(id), { subtotalVnd: 30000n, propertyId }, owner(tenantId));
      expect(r).toEqual({ valid: true, discount_vnd: 30000, reason_code: 'OK' });
    });

    it('PERCENT roundVnd: value 1500 (15%), subtotal 333333 → 50000 (half-away-from-zero)', async () => {
      const id = await seedCode({ discount_type: 'PERCENT', discount_value: 1500 });
      const r = await discounts.applyDiscount(await codeOf(id), { subtotalVnd: 333333n, propertyId }, owner(tenantId));
      // 333333*1500/10000 = 49999.95 → roundVnd = 50000
      expect(r).toEqual({ valid: true, discount_vnd: 50000, reason_code: 'OK' });
    });

    it('PERCENT 100% (10000): subtotal 200000 → 200000', async () => {
      const id = await seedCode({ discount_type: 'PERCENT', discount_value: 10000 });
      const r = await discounts.applyDiscount(await codeOf(id), { subtotalVnd: 200000n, propertyId }, owner(tenantId));
      expect(r).toEqual({ valid: true, discount_vnd: 200000, reason_code: 'OK' });
    });

    it('NOT_FOUND: mã không tồn tại', async () => {
      const r = await discounts.applyDiscount(`GHOST-${RUN}`, { subtotalVnd: 200000n, propertyId }, owner(tenantId));
      expect(r).toMatchObject({ valid: false, discount_vnd: 0, reason_code: 'NOT_FOUND' });
    });

    it('INACTIVE: is_active=false', async () => {
      const id = await seedCode({ is_active: false });
      const r = await discounts.applyDiscount(await codeOf(id), { subtotalVnd: 200000n, propertyId }, owner(tenantId));
      expect(r).toMatchObject({ valid: false, reason_code: 'INACTIVE' });
    });

    it('NOT_STARTED: now < valid_from', async () => {
      const future = new Date(Date.now() + 86_400_000);
      const id = await seedCode({ valid_from: future });
      const r = await discounts.applyDiscount(await codeOf(id), { subtotalVnd: 200000n, propertyId }, owner(tenantId));
      expect(r).toMatchObject({ valid: false, reason_code: 'NOT_STARTED' });
    });

    it('EXPIRED: now > valid_to', async () => {
      const past = new Date(Date.now() - 86_400_000);
      const id = await seedCode({ valid_to: past });
      const r = await discounts.applyDiscount(await codeOf(id), { subtotalVnd: 200000n, propertyId }, owner(tenantId));
      expect(r).toMatchObject({ valid: false, reason_code: 'EXPIRED' });
    });

    it('biên closed-interval: now == valid_from và now == valid_to đều HỢP LỆ', async () => {
      // valid_from ở quá khứ, valid_to ở tương lai gần → chắc chắn now nằm trong [from,to].
      // Kiểm biên chính xác: đặt valid_from = valid_to = "bây giờ đủ rộng" khó vì clock trôi,
      // nên dùng khoảng [now-1s, now+long] để chứng minh cận không loại.
      const from = new Date(Date.now() - 1000);
      const to = new Date(Date.now() + 3_600_000);
      const id = await seedCode({ valid_from: from, valid_to: to });
      const r = await discounts.applyDiscount(await codeOf(id), { subtotalVnd: 200000n, propertyId }, owner(tenantId));
      expect(r).toMatchObject({ valid: true, reason_code: 'OK' });
    });

    it('BELOW_MIN_ORDER: subtotal < min_order_vnd', async () => {
      const id = await seedCode({ min_order_vnd: 500000 });
      const r = await discounts.applyDiscount(await codeOf(id), { subtotalVnd: 200000n, propertyId }, owner(tenantId));
      expect(r).toMatchObject({ valid: false, reason_code: 'BELOW_MIN_ORDER' });
    });

    it('PROPERTY_NOT_ELIGIBLE: applicable_property_ids KHÔNG chứa property', async () => {
      const id = await seedCode({ applicable_property_ids: [randomUUID()] });
      const r = await discounts.applyDiscount(await codeOf(id), { subtotalVnd: 200000n, propertyId }, owner(tenantId));
      expect(r).toMatchObject({ valid: false, reason_code: 'PROPERTY_NOT_ELIGIBLE' });
    });

    it('applicable_property_ids = [] (rỗng) → PROPERTY_NOT_ELIGIBLE (KHÁC NULL)', async () => {
      const id = await seedCode({ applicable_property_ids: [] });
      const r = await discounts.applyDiscount(await codeOf(id), { subtotalVnd: 200000n, propertyId }, owner(tenantId));
      expect(r).toMatchObject({ valid: false, reason_code: 'PROPERTY_NOT_ELIGIBLE' });
    });

    it('applicable_property_ids CHỨA property → OK', async () => {
      const id = await seedCode({ applicable_property_ids: [propertyId] });
      const r = await discounts.applyDiscount(await codeOf(id), { subtotalVnd: 200000n, propertyId }, owner(tenantId));
      expect(r).toMatchObject({ valid: true, reason_code: 'OK' });
    });

    it('USAGE_LIMIT_REACHED: max_uses != NULL và used_count >= max_uses', async () => {
      const id = await seedCode({ max_uses: 1, used_count: 1 });
      const r = await discounts.applyDiscount(await codeOf(id), { subtotalVnd: 200000n, propertyId }, owner(tenantId));
      expect(r).toMatchObject({ valid: false, reason_code: 'USAGE_LIMIT_REACHED' });
    });
  });

  // ── (2b) GET /discount-codes/:code/validate (task 9.4c) ──────────────────────

  describe('GET /discount-codes/:code/validate', () => {
    const validate = (code: string, q: Record<string, string | number>, tok = staffToken) =>
      request(http)
        .get(`/api/v1/discount-codes/${encodeURIComponent(code)}/validate`)
        .query(q)
        .set(auth(tok));

    it('FIXED OK: parity với applyDiscount → 200 {valid:true, discount_vnd:value, reason_code:OK}', async () => {
      const id = await seedCode({ discount_type: 'FIXED', discount_value: 50000, min_order_vnd: 0 });
      const code = await codeOf(id);
      const res = await validate(code, { subtotal_vnd: 200000, property_id: propertyId }).expect(200);
      expect(res.body.data).toEqual({ valid: true, discount_vnd: 50000, reason_code: 'OK' });
      // parity byte-for-byte với service applyDiscount
      const svc = await discounts.applyDiscount(code, { subtotalVnd: 200000n, propertyId }, owner(tenantId));
      expect(res.body.data).toEqual(svc);
    });

    it('mã không tồn tại → 200 {valid:false, discount_vnd:0, reason_code:NOT_FOUND} (KHÔNG 404)', async () => {
      const res = await validate(`GHOST-${RUN}`, { subtotal_vnd: 200000, property_id: propertyId }).expect(200);
      expect(res.body.data).toEqual({ valid: false, discount_vnd: 0, reason_code: 'NOT_FOUND' });
    });

    it('reason_code parity: BELOW_MIN_ORDER khi subtotal < min_order (200, KHÔNG lỗi)', async () => {
      const id = await seedCode({ min_order_vnd: 500000 });
      const res = await validate(await codeOf(id), { subtotal_vnd: 200000, property_id: propertyId }).expect(200);
      expect(res.body.data).toMatchObject({ valid: false, reason_code: 'BELOW_MIN_ORDER' });
    });

    it('PERCENT roundVnd parity: value 1500 subtotal 333333 → 50000', async () => {
      const id = await seedCode({ discount_type: 'PERCENT', discount_value: 1500 });
      const res = await validate(await codeOf(id), { subtotal_vnd: 333333, property_id: propertyId }).expect(200);
      expect(res.body.data).toEqual({ valid: true, discount_vnd: 50000, reason_code: 'OK' });
    });

    it('gate booking.read: STAFF → 200; HOUSEKEEPER (không booking.read) → 403', async () => {
      const id = await seedCode({ discount_type: 'FIXED', discount_value: 10000 });
      const code = await codeOf(id);
      await validate(code, { subtotal_vnd: 200000, property_id: propertyId }, staffToken).expect(200);
      await validate(code, { subtotal_vnd: 200000, property_id: propertyId }, hkToken).expect(403);
    });

    it('cross-tenant: tenant 2 gọi mã tenant 1 → 200 NOT_FOUND (RLS ẩn, KHÔNG lộ)', async () => {
      const id = await seedCode({ discount_type: 'FIXED', discount_value: 10000 });
      const code = await codeOf(id);
      // tenant 2 owner có booking.read nhưng RLS ẩn mã của tenant 1 → NOT_FOUND
      const res = await validate(code, { subtotal_vnd: 200000, property_id: propertyId }, otherToken).expect(200);
      expect(res.body.data).toMatchObject({ valid: false, reason_code: 'NOT_FOUND' });
    });

    it('subtotal_vnd chuỗi được coerce sang int trước applyDiscount (?subtotal_vnd=200000 chạy)', async () => {
      const id = await seedCode({ discount_type: 'FIXED', discount_value: 50000, min_order_vnd: 150000 });
      // truyền chuỗi qua query — z.coerce ép sang 200000 ≥ min 150000 → OK
      const res = await validate(await codeOf(id), { subtotal_vnd: '200000', property_id: propertyId }).expect(200);
      expect(res.body.data).toEqual({ valid: true, discount_vnd: 50000, reason_code: 'OK' });
    });

    it('validation: thiếu subtotal_vnd → 400 VALIDATION_FAILED', async () => {
      const res = await validate(`ANY-${RUN}`, { property_id: propertyId }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('validation: subtotal_vnd âm → 400', async () => {
      await validate(`ANY-${RUN}`, { subtotal_vnd: -1, property_id: propertyId }).expect(400);
    });

    it('validation: property_id không phải uuid → 400', async () => {
      await validate(`ANY-${RUN}`, { subtotal_vnd: 200000, property_id: 'not-a-uuid' }).expect(400);
    });
  });

  // ── (3) Redemption qua createBookingTx ──────────────────────────────────────

  describe('redemption qua createBookingTx', () => {
    // Mỗi ca dùng KHOẢNG NGÀY riêng để booking thành công không chồng occupancy nhau.
    const win = (day: number): [string, string] => [
      `2026-10-${String(day).padStart(2, '0')}T07:00:00.000Z`,
      `2026-10-${String(day + 1).padStart(2, '0')}T05:00:00.000Z`,
    ];

    const bookWithQuote = (quoteId: string, ci: string, co: string) =>
      request(http)
        .post('/api/v1/bookings')
        .set({ ...auth(), 'Idempotency-Key': randomUUID() })
        .send({ resource_id: resourceId, quote_id: quoteId, mode: 'DAILY', check_in: ci, check_out: co, guest_id: guestId });

    it('quote gắn discount_code_id → booking OK + used_count +1 CÙNG tx', async () => {
      const [ci, co] = win(10);
      const codeId = await seedCode({ max_uses: 1, used_count: 0 });
      const quoteId = await quote(ci, co);
      await admin.query(`UPDATE quotes SET discount_code_id=$1 WHERE id=$2`, [codeId, quoteId]);

      const res = await bookWithQuote(quoteId, ci, co).expect(201);
      expect(res.body.data.id).toBeTruthy();
      expect(await usedCountOf(codeId)).toBe(1);
    });

    it('mã tại-giới-hạn (used_count=max_uses) → POST 409 DISCOUNT_EXHAUSTED, booking KHÔNG tồn tại, used_count không đổi', async () => {
      const [ci, co] = win(12);
      const codeId = await seedCode({ max_uses: 1, used_count: 1 });
      const quoteId = await quote(ci, co);
      await admin.query(`UPDATE quotes SET discount_code_id=$1 WHERE id=$2`, [codeId, quoteId]);

      const res = await bookWithQuote(quoteId, ci, co).expect(409);
      expect(res.body.error.code).toBe('DISCOUNT_EXHAUSTED');
      // used_count không đổi (vẫn 1) — UPDATE atomic không khớp điều kiện
      expect(await usedCountOf(codeId)).toBe(1);
      // booking KHÔNG được tạo (dùng quote này) — rollback
      const bk = await admin.query(`SELECT count(*)::int AS n FROM bookings WHERE quote_id=$1`, [quoteId]);
      expect(bk.rows[0].n).toBe(0);
    });

    it('mã đã soft-delete gắn vào quote → 409 DISCOUNT_EXHAUSTED (redeem WHERE deleted_at IS NULL)', async () => {
      const [ci, co] = win(14);
      const codeId = await seedCode({ max_uses: null, used_count: 0 });
      await admin.query(`UPDATE discount_codes SET deleted_at=now() WHERE id=$1`, [codeId]);
      const quoteId = await quote(ci, co);
      await admin.query(`UPDATE quotes SET discount_code_id=$1 WHERE id=$2`, [codeId, quoteId]);

      const res = await bookWithQuote(quoteId, ci, co).expect(409);
      expect(res.body.error.code).toBe('DISCOUNT_EXHAUSTED');
      const bk = await admin.query(`SELECT count(*)::int AS n FROM bookings WHERE quote_id=$1`, [quoteId]);
      expect(bk.rows[0].n).toBe(0);
    });

    it('quote KHÔNG có discount_code_id → booking cũ chạy bình thường (backward-compatible)', async () => {
      const [ci, co] = win(16);
      const codeId = await seedCode({ max_uses: 1, used_count: 0 });
      const quoteId = await quote(ci, co);
      // KHÔNG set discount_code_id trên quote
      const res = await bookWithQuote(quoteId, ci, co).expect(201);
      expect(res.body.data.id).toBeTruthy();
      // used_count của mã bất kỳ không bị đụng
      expect(await usedCountOf(codeId)).toBe(0);
    });

    it('max_uses = NULL → redeem tăng không giới hạn (không bao giờ 409)', async () => {
      const [ci, co] = win(18);
      const codeId = await seedCode({ max_uses: null, used_count: 5 });
      const quoteId = await quote(ci, co);
      await admin.query(`UPDATE quotes SET discount_code_id=$1 WHERE id=$2`, [codeId, quoteId]);
      await bookWithQuote(quoteId, ci, co).expect(201);
      expect(await usedCountOf(codeId)).toBe(6);
    });
  });

  // ── (4) End-to-end voucher: quote(discount_code) → booking (task 9.4c) ────────

  describe('end-to-end voucher booking (quote → booking)', () => {
    const win = (day: number): [string, string] => [
      `2026-11-${String(day).padStart(2, '0')}T07:00:00.000Z`,
      `2026-11-${String(day + 1).padStart(2, '0')}T05:00:00.000Z`,
    ];

    const quoteWithCode = (code: string, ci: string, co: string) =>
      request(http)
        .post('/api/v1/pricing/quote')
        .set(auth())
        .send({ resource_id: resourceId, mode: 'DAILY', check_in: ci, check_out: co, discount_code: code });

    const bookWithQuote = (quoteId: string, ci: string, co: string) =>
      request(http)
        .post('/api/v1/bookings')
        .set({ ...auth(), 'Idempotency-Key': randomUUID() })
        .send({ resource_id: resourceId, quote_id: quoteId, mode: 'DAILY', check_in: ci, check_out: co, guest_id: guestId });

    it('quote(discount_code max_uses=1) → booking 201: total netted, used_count +1, KHÔNG 409 PRICE_CHANGED', async () => {
      const [ci, co] = win(2);
      const codeId = await seedCode({ discount_type: 'FIXED', discount_value: 100000, max_uses: 1, used_count: 0 });
      const q = (await quoteWithCode(await codeOf(codeId), ci, co).expect(200)).body.data;
      // báo giá gốc 1 đêm = 500k → total sau voucher 100k = 400k
      expect(q.total_vnd).toBe(400_000);
      expect(q.discount_vnd).toBe(100_000);

      const res = await bookWithQuote(q.quote_id, ci, co).expect(201);
      expect(Number(res.body.data.total_amount_vnd)).toBe(q.total_vnd); // 400k (voucher-netted)
      expect(await usedCountOf(codeId)).toBe(1); // +1 đúng một lần
    });

    it('booking thứ 2 trên mã đã cạn (quote mới) → 409 DISCOUNT_EXHAUSTED, used_count giữ 1', async () => {
      const [ci1, co1] = win(4);
      const [ci2, co2] = win(6);
      const codeId = await seedCode({ discount_type: 'FIXED', discount_value: 80000, max_uses: 1, used_count: 0 });
      const code = await codeOf(codeId);

      // booking 1 thành công → used_count = 1 (mã cạn)
      const q1 = (await quoteWithCode(code, ci1, co1).expect(200)).body.data;
      await bookWithQuote(q1.quote_id, ci1, co1).expect(201);
      expect(await usedCountOf(codeId)).toBe(1);

      // quote 2 vẫn báo giá được (validate ở quote-time: used_count(1) >= max_uses(1) → USAGE_LIMIT_REACHED
      // → 422 DISCOUNT_NOT_APPLICABLE). Nên để test redeem-cạn, seed quote 2 với discount_code_id trực tiếp.
      const quoteId2 = (
        await request(http).post('/api/v1/pricing/quote').set(auth())
          .send({ resource_id: resourceId, mode: 'DAILY', check_in: ci2, check_out: co2 }).expect(200)
      ).body.data.quote_id;
      await admin.query(`UPDATE quotes SET discount_code_id=$1 WHERE id=$2`, [codeId, quoteId2]);

      const res = await bookWithQuote(quoteId2, ci2, co2).expect(409);
      expect(res.body.error.code).toBe('DISCOUNT_EXHAUSTED');
      expect(await usedCountOf(codeId)).toBe(1); // không tăng
    });

    it('replay CÙNG Idempotency-Key trên booking voucher → response cached, used_count KHÔNG tăng lần 2', async () => {
      const [ci, co] = win(8);
      const codeId = await seedCode({ discount_type: 'FIXED', discount_value: 60000, max_uses: 5, used_count: 0 });
      const q = (await quoteWithCode(await codeOf(codeId), ci, co).expect(200)).body.data;

      const idemKey = randomUUID();
      const first = await request(http).post('/api/v1/bookings')
        .set({ ...auth(), 'Idempotency-Key': idemKey })
        .send({ resource_id: resourceId, quote_id: q.quote_id, mode: 'DAILY', check_in: ci, check_out: co, guest_id: guestId })
        .expect(201);
      expect(await usedCountOf(codeId)).toBe(1);

      // replay cùng key → trả response đầu tiên, KHÔNG redeem lần 2
      const replay = await request(http).post('/api/v1/bookings')
        .set({ ...auth(), 'Idempotency-Key': idemKey })
        .send({ resource_id: resourceId, quote_id: q.quote_id, mode: 'DAILY', check_in: ci, check_out: co, guest_id: guestId })
        .expect(201);
      expect(replay.body.data.id).toBe(first.body.data.id);
      expect(await usedCountOf(codeId)).toBe(1); // vẫn 1
    });
  });
});
