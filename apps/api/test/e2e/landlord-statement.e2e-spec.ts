import 'reflect-metadata';
import * as argon2 from 'argon2';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance TASK 9.1 (docs/16 #14): GET /reports/landlord-statement — báo cáo kỳ
 * cho chủ nhà gốc của cơ sở rent-to-rent. Mô hình chia % doanh thu (payout =
 * revenue × bp) hoặc thuê cố định (prorate theo ngày). Chỉ cơ sở is_rent_to_rent;
 * cần report.financial. Seed doanh thu bằng SQL (rollup) + chi phí qua API; range
 * tháng 4 (quá khứ) → không dính phần live hôm nay.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const slugA = `lls-a-${RUN}`;
const slugB = `lls-b-${RUN}`;
const ownerA = `owner-a-${RUN}@e2e.test`;
const ownerB = `owner-b-${RUN}@e2e.test`;
const hkEmail = `hk-${RUN}@e2e.test`;

describe('Landlord statement R2R (task 9.1, docs/16 #14)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string; // owner tenant A
  let hkToken: string; // HOUSEKEEPER tenant A (thiếu report.financial)
  let tokenB: string; // owner tenant B (cross-tenant)
  let tenantId: string;
  let shareProp: string; // R2R chia % doanh thu (bp = 2000 → 20%)
  let rentProp: string; // R2R thuê cố định 10tr/tháng
  let plainProp: string; // không R2R

  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const stmt = (prop: string, from: string, to: string, t = token) =>
    request(http)
      .get(`/api/v1/reports/landlord-statement?property_id=${prop}&from=${from}&to=${to}`)
      .set(auth(t));

  beforeAll(async () => {
    const env = loadEnv();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();

    const register = (slug: string, email: string, name: string) =>
      request(http)
        .post('/api/v1/auth/register')
        .send({ tenant_slug: slug, tenant_display_name: name, email, password: PASSWORD, full_name: 'Owner' })
        .expect(201);
    await register(slugA, ownerA, 'LLS A');
    await register(slugB, ownerB, 'LLS B');

    token = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', slugA).send({ email: ownerA, password: PASSWORD }).expect(200)
    ).body.data.access_token;
    tokenB = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', slugB).send({ email: ownerB, password: PASSWORD }).expect(200)
    ).body.data.access_token;
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [slugA])).rows[0].id as string;
    // ENTERPRISE để tạo nhiều property (FREE max_properties = 1).
    await admin.query(
      `UPDATE tenants SET subscription_plan_id = (SELECT id FROM subscription_plans WHERE code = 'ENTERPRISE') WHERE id = $1`,
      [tenantId],
    );

    const mkProp = (body: Record<string, unknown>) =>
      request(http).post('/api/v1/properties').set(auth()).send(body).expect(201);
    shareProp = (
      await mkProp({
        name: 'R2R Share',
        property_type: 'RENT_TO_RENT',
        address_line: 'a',
        province: 'Đà Nẵng',
        is_rent_to_rent: true,
        landlord_name: 'Chủ A',
        landlord_phone: '0900000001',
        rent_to_rent_contract_start: '2026-01-01',
        rent_to_rent_contract_end: '2026-12-31',
        landlord_revenue_share_bp: 2000, // 20%
      })
    ).body.data.id;
    rentProp = (
      await mkProp({
        name: 'R2R Rent',
        property_type: 'RENT_TO_RENT',
        address_line: 'a',
        province: 'Đà Nẵng',
        is_rent_to_rent: true,
        landlord_name: 'Chủ B',
        monthly_landlord_rent_vnd: 10_000_000,
      })
    ).body.data.id;
    plainProp = (
      await mkProp({ name: 'Homestay thường', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' })
    ).body.data.id;

    // Doanh thu rollup cho shareProp: 1 ngày tháng 4 (quá khứ) — 10tr phòng, 6/10 occupied.
    await admin.query(
      `INSERT INTO daily_property_stats (tenant_id, property_id, stat_date, available_room_nights, occupied_room_nights, room_revenue_vnd, other_revenue_vnd, adr_vnd, revpar_vnd)
       VALUES ($1,$2,'2026-04-10',10,6,10000000,0,1666667,1000000)`,
      [tenantId, shareProp],
    );

    // Chi phí rentProp tháng 4: RENT_LANDLORD 10tr (direct) + ĐIỆN 1tr (direct) →
    // operating_cost (chưa gồm RENT_LANDLORD) = 1tr.
    const mkExpense = (prop: string, type: string, amount: number, date: string) =>
      request(http).post('/api/v1/expenses').set(auth()).send({ property_id: prop, expense_type: type, amount_vnd: amount, expense_date: date }).expect(201);
    await mkExpense(rentProp, 'RENT_LANDLORD', 10_000_000, '2026-04-05');
    await mkExpense(rentProp, 'ELECTRICITY', 1_000_000, '2026-04-06');

    // HOUSEKEEPER tenant A (không có report.financial) cho test 403.
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const hk = await admin.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, default_role) VALUES ($1,$2,$3,'Buồng phòng','HOUSEKEEPER') RETURNING id`,
      [tenantId, hkEmail, hash],
    );
    await admin.query(`INSERT INTO user_property_roles (tenant_id, user_id, property_id, role) VALUES ($1,$2,$3,'HOUSEKEEPER')`, [tenantId, hk.rows[0].id, shareProp]);
    hkToken = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', slugA).send({ email: hkEmail, password: PASSWORD }).expect(200)
    ).body.data.access_token;
  });

  afterAll(async () => {
    if (admin) {
      for (const slug of [slugA, slugB]) {
        const tid = `(SELECT id FROM tenants WHERE slug = '${slug}')`;
        await admin.query(`DELETE FROM daily_property_stats WHERE tenant_id IN ${tid}`);
        await admin.query(`DELETE FROM operational_expenses WHERE tenant_id IN ${tid}`);
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

  it('★ REVENUE_SHARE — payout = doanh thu × % (bp)', async () => {
    const r = (await stmt(shareProp, '2026-04-01', '2026-04-30').expect(200)).body.data;
    expect(r.property_name).toBe('R2R Share');
    expect(r.landlord_name).toBe('Chủ A');
    expect(r.landlord_phone).toBe('0900000001');
    expect(r.contract_start).toBe('2026-01-01');
    expect(r.contract_end).toBe('2026-12-31');
    expect(r.settlement_model).toBe('REVENUE_SHARE');
    expect(r.revenue_total_vnd).toBe(10_000_000);
    expect(r.revenue_share_bp).toBe(2000);
    expect(r.monthly_landlord_rent_vnd).toBeNull();
    expect(r.landlord_payout_vnd).toBe(2_000_000); // 10tr × 20%
    // occupancy context
    expect(r.occupied_room_nights).toBe(6);
    expect(r.available_room_nights).toBe(10);
    expect(r.occupancy_rate_pct).toBe(60);
  });

  it('★ FIXED_RENT — nguyên tháng = nguyên tiền thuê; operating_cost loại RENT_LANDLORD', async () => {
    const r = (await stmt(rentProp, '2026-04-01', '2026-04-30').expect(200)).body.data;
    expect(r.settlement_model).toBe('FIXED_RENT');
    expect(r.monthly_landlord_rent_vnd).toBe(10_000_000);
    expect(r.revenue_share_bp).toBeNull();
    expect(r.landlord_payout_vnd).toBe(10_000_000); // nguyên tháng 4 (30 ngày)
    expect(r.operating_cost_vnd).toBe(1_000_000); // chỉ điện 1tr (đã loại RENT_LANDLORD 10tr)
  });

  it('★ FIXED_RENT — prorate nửa tháng (15/30 ngày) = 1/2 tiền thuê', async () => {
    const r = (await stmt(rentProp, '2026-04-01', '2026-04-15').expect(200)).body.data;
    expect(r.settlement_model).toBe('FIXED_RENT');
    expect(r.landlord_payout_vnd).toBe(5_000_000); // 15/30 × 10tr
  });

  it('cơ sở KHÔNG phải R2R → 422 NOT_RENT_TO_RENT', async () => {
    const res = await stmt(plainProp, '2026-04-01', '2026-04-30').expect(422);
    expect(res.body.error.code).toBe('NOT_RENT_TO_RENT');
  });

  it('HOUSEKEEPER (thiếu report.financial) → 403', async () => {
    await stmt(shareProp, '2026-04-01', '2026-04-30', hkToken).expect(403);
  });

  it('cross-tenant (token B đọc property tenant A) → 404 (RLS giấu tồn tại)', async () => {
    await stmt(shareProp, '2026-04-01', '2026-04-30', tokenB).expect(404);
  });
});
