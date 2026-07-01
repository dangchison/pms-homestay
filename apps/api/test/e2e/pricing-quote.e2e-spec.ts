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
import { PricingService } from '@modules/pricing/pricing.service';

/**
 * ★ Acceptance task 2.4: POST /pricing/quote tính bằng pricing-engine + INSERT
 * bảng `quotes` (snapshot version, expires 15'); resolve gói giá theo resource;
 * holidays load từ DB; cron purge (>7 ngày) — service purgeExpired.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `pq-${RUN}`;

describe('POST /pricing/quote + persist (task 2.4)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let tenantId: string;
  let propertyId: string;
  let resourceId: string;
  let planId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

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
        tenant_display_name: 'PQ E2E',
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
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id;

    propertyId = (
      await request(http)
        .post('/api/v1/properties')
        .set(auth())
        .send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' })
        .expect(201)
    ).body.data.id;
    await request(http)
      .post('/api/v1/rooms')
      .set(auth())
      .send({ property_id: propertyId, room_number: '101' })
      .expect(201);
    resourceId = (
      await request(http).get(`/api/v1/bookable-resources?property_id=${propertyId}`).set(auth())
    ).body.data[0].id;

    // Gói DAILY base 500k, cọc 30%, cuối tuần +20% (priority 10) + lễ OVERRIDE 2tr (priority 100)
    planId = (
      await request(http)
        .post('/api/v1/rate-plans')
        .set(auth())
        .send({
          property_id: propertyId,
          name: 'DAILY',
          mode: 'DAILY',
          base_price_vnd: 500_000,
          deposit_type: 'PERCENT',
          deposit_value: 3000,
          effective_from: '2026-01-01',
          resource_ids: [resourceId],
        })
        .expect(201)
    ).body.data.id;
    await request(http)
      .post(`/api/v1/rate-plans/${planId}/rules`)
      .set(auth())
      .send({ rule_type: 'WEEKEND', days_of_week: [0, 6], price_modifier_type: 'PERCENT', price_modifier_value: 2000, priority: 10 })
      .expect(201);
    await request(http)
      .post(`/api/v1/rate-plans/${planId}/rules`)
      .set(auth())
      .send({ rule_type: 'HOLIDAY', price_modifier_type: 'OVERRIDE', price_modifier_value: 2_000_000, priority: 100 })
      .expect(201);
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM quotes WHERE tenant_id IN ${tid}`); // trước discount_codes (FK)
      await admin.query(`DELETE FROM discount_codes WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM rate_plans WHERE tenant_id IN ${tid}`);
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

  it('quote 1 đêm cuối tuần → tính +20%, persist `quotes`, trả quote_id + expires', async () => {
    // 23/5/2026 (T7) 14:00 VN = 07:00Z → 24/5 12:00 VN
    const res = await request(http)
      .post('/api/v1/pricing/quote')
      .set(auth())
      .send({
        resource_id: resourceId,
        mode: 'DAILY',
        check_in: '2026-05-23T07:00:00.000Z',
        check_out: '2026-05-24T05:00:00.000Z',
      })
      .expect(200);
    expect(res.body.data.total_vnd).toBe(600_000); // 500k × 1.2
    expect(res.body.data.deposit_vnd).toBe(180_000); // 30%
    expect(res.body.data.line_items).toHaveLength(1);
    expect(res.body.data.rate_plan_version).toBe(3); // v1 tạo + 2 lần thêm rule bump → 3 (snapshot)
    expect(new Date(res.body.data.expires_at).getTime()).toBeGreaterThan(Date.now());

    const persisted = await admin.query(`SELECT total_vnd FROM quotes WHERE id = $1`, [
      res.body.data.quote_id,
    ]);
    expect(persisted.rows).toHaveLength(1);
    expect(Number(persisted.rows[0].total_vnd)).toBe(600_000);
  });

  it('quote đêm lễ (Tết mùng 1 17/2/2026 đã seed) → OVERRIDE 2tr + holidays trả về', async () => {
    const res = await request(http)
      .post('/api/v1/pricing/quote')
      .set(auth())
      .send({
        resource_id: resourceId,
        mode: 'DAILY',
        check_in: '2026-02-17T07:00:00.000Z',
        check_out: '2026-02-18T05:00:00.000Z',
      })
      .expect(200);
    expect(res.body.data.total_vnd).toBe(2_000_000);
    expect(res.body.data.holidays.some((h: { date: string }) => h.date === '2026-02-17')).toBe(true);
  });

  it('không có gói cho mode → 422 NO_APPLICABLE_RATE_PLAN', async () => {
    const res = await request(http)
      .post('/api/v1/pricing/quote')
      .set(auth())
      .send({
        resource_id: resourceId,
        mode: 'HOURLY',
        check_in: '2026-05-23T07:00:00.000Z',
        check_out: '2026-05-23T10:00:00.000Z',
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_APPLICABLE_RATE_PLAN');
  });

  it('rate_plan_id sai chế độ → 422 RATE_PLAN_INVALID', async () => {
    const res = await request(http)
      .post('/api/v1/pricing/quote')
      .set(auth())
      .send({
        resource_id: resourceId,
        rate_plan_id: planId, // gói DAILY
        mode: 'HOURLY',
        check_in: '2026-05-23T07:00:00.000Z',
        check_out: '2026-05-23T10:00:00.000Z',
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('RATE_PLAN_INVALID');
  });

  it('check_out <= check_in → 400 (zod)', async () => {
    await request(http)
      .post('/api/v1/pricing/quote')
      .set(auth())
      .send({
        resource_id: resourceId,
        mode: 'DAILY',
        check_in: '2026-05-23T07:00:00.000Z',
        check_out: '2026-05-23T07:00:00.000Z',
      })
      .expect(400);
  });

  // ── Voucher (task 9.4c): quote WITH discount_code ────────────────────────────

  describe('quote WITH discount_code (task 9.4c)', () => {
    // Đêm thường 19/5/2026 (T3, không lễ) → base 500k phẳng, dễ kiểm số.
    const CI = '2026-05-19T07:00:00.000Z';
    const CO = '2026-05-20T05:00:00.000Z';

    /** Seed mã trực tiếp (admin) → điều khiển mọi cột. */
    const seedCode = async (over: Record<string, unknown> = {}): Promise<string> => {
      const c = {
        code: `PQ-${randomUUID().slice(0, 8)}`,
        discount_type: 'FIXED',
        discount_value: 100000,
        min_order_vnd: 0,
        applicable_property_ids: null as string[] | null,
        is_active: true,
        ...over,
      };
      const res = await admin.query(
        `INSERT INTO discount_codes (tenant_id, code, discount_type, discount_value, min_order_vnd, applicable_property_ids, is_active)
         VALUES ($1,$2,$3::discount_type,$4,$5,$6,$7) RETURNING id, code`,
        [tenantId, c.code, c.discount_type, c.discount_value, c.min_order_vnd, c.applicable_property_ids, c.is_active],
      );
      return res.rows[0].code;
    };

    const quoteWith = (body: Record<string, unknown>) =>
      request(http).post('/api/v1/pricing/quote').set(auth()).send({ resource_id: resourceId, mode: 'DAILY', check_in: CI, check_out: CO, ...body });

    it('FIXED: total netted, line_items có DISCOUNT âm, quotes.discount_code_id persisted', async () => {
      const code = await seedCode({ discount_type: 'FIXED', discount_value: 100000 });
      const res = await quoteWith({ discount_code: code }).expect(200);
      // subtotal 500k, voucher 100k → discount_vnd 100k, total 400k, tax 0
      expect(res.body.data.subtotal_vnd).toBe(500_000);
      expect(res.body.data.discount_vnd).toBe(100_000);
      expect(res.body.data.total_vnd).toBe(400_000);
      expect(res.body.data.discount_code).toBe(code);
      const disc = res.body.data.line_items.find((li: { type: string }) => li.type === 'DISCOUNT');
      expect(disc).toMatchObject({ type: 'DISCOUNT', amount_vnd: -100_000 });

      const row = await admin.query(
        `SELECT discount_code_id, discount_vnd, total_vnd FROM quotes WHERE id=$1`,
        [res.body.data.quote_id],
      );
      expect(row.rows[0].discount_code_id).toBeTruthy();
      expect(Number(row.rows[0].discount_vnd)).toBe(100_000);
      expect(Number(row.rows[0].total_vnd)).toBe(400_000);
    });

    it('PERCENT roundVnd parity: value 1500 (15%) trên subtotal 500000 → voucher 75000', async () => {
      const code = await seedCode({ discount_type: 'PERCENT', discount_value: 1500 });
      const res = await quoteWith({ discount_code: code }).expect(200);
      // 500000*1500/10000 = 75000
      expect(res.body.data.discount_vnd).toBe(75_000);
      expect(res.body.data.total_vnd).toBe(425_000);
    });

    it('FIXED cap: voucher > subtotal → giảm = subtotal (total 0, không âm)', async () => {
      const code = await seedCode({ discount_type: 'FIXED', discount_value: 900000 });
      const res = await quoteWith({ discount_code: code }).expect(200);
      expect(res.body.data.discount_vnd).toBe(500_000);
      expect(res.body.data.total_vnd).toBe(0);
    });

    it('mã KHÔNG hợp lệ → 422 DISCOUNT_NOT_APPLICABLE (reason trong detail), KHÔNG persist quote', async () => {
      const before = (await admin.query(`SELECT count(*)::int AS n FROM quotes WHERE tenant_id=$1`, [tenantId])).rows[0].n;
      // mã không tồn tại → reason NOT_FOUND
      const res = await quoteWith({ discount_code: `GHOST-${randomUUID().slice(0, 6)}` }).expect(422);
      expect(res.body.error.code).toBe('DISCOUNT_NOT_APPLICABLE');
      expect(res.body.error.detail).toBe('NOT_FOUND');
      const after = (await admin.query(`SELECT count(*)::int AS n FROM quotes WHERE tenant_id=$1`, [tenantId])).rows[0].n;
      expect(after).toBe(before); // KHÔNG có quote mồ côi
    });

    it('mã inactive → 422 (reason INACTIVE), KHÔNG persist', async () => {
      const code = await seedCode({ is_active: false });
      const res = await quoteWith({ discount_code: code }).expect(422);
      expect(res.body.error.code).toBe('DISCOUNT_NOT_APPLICABLE');
      expect(res.body.error.detail).toBe('INACTIVE');
    });

    it('KHÔNG discount_code → byte-identical path cũ: discount_vnd 0, total = subtotal, discount_code_id NULL, KHÔNG DISCOUNT line', async () => {
      const res = await quoteWith({}).expect(200);
      expect(res.body.data.discount_vnd).toBe(0);
      expect(res.body.data.total_vnd).toBe(res.body.data.subtotal_vnd);
      expect(res.body.data.discount_code).toBeUndefined();
      expect(res.body.data.line_items.some((li: { type: string }) => li.type === 'DISCOUNT')).toBe(false);
      const row = await admin.query(`SELECT discount_code_id FROM quotes WHERE id=$1`, [res.body.data.quote_id]);
      expect(row.rows[0].discount_code_id).toBeNull();
    });
  });

  it('purgeExpired: quote quá hạn > 7 ngày chưa dùng bị dọn', async () => {
    const created = await request(http)
      .post('/api/v1/pricing/quote')
      .set(auth())
      .send({
        resource_id: resourceId,
        mode: 'DAILY',
        check_in: '2026-05-23T07:00:00.000Z',
        check_out: '2026-05-24T05:00:00.000Z',
      })
      .expect(200);
    const quoteId = created.body.data.quote_id;
    // lùi hạn 8 ngày
    await admin.query(`UPDATE quotes SET expires_at = now() - interval '8 days' WHERE id = $1`, [
      quoteId,
    ]);

    const purged = await app.get(PricingService).purgeExpired(tenantId);
    expect(purged).toBeGreaterThanOrEqual(1);
    const gone = await admin.query(`SELECT 1 FROM quotes WHERE id = $1`, [quoteId]);
    expect(gone.rows).toHaveLength(0);
  });
});
