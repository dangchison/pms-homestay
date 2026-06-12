import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';

/**
 * ★ Acceptance task 3.7 (docs/09 §8/§10): GET /reports/pnl đọc rollup
 * daily_property_stats + expenses/depreciation → doanh thu/chi phí trực tiếp/vận
 * hành/gross/net + occupancy; GET /reports/break-even 3 kịch bản ADR + occupancy
 * hoà vốn. Seed stats + depreciation bằng SQL, expenses qua API (range quá khứ →
 * không dính phần live hôm nay).
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `rpt-${RUN}`;

describe('Reports — P&L + break-even (task 3.7)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let tenantId: string;
  let propertyId: string;

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
      .send({ tenant_slug: tenantSlug, tenant_display_name: 'RPT E2E', email: `owner-${RUN}@e2e.test`, password: PASSWORD, full_name: 'Owner' })
      .expect(201);
    token = (
      await request(http).post('/api/v1/auth/login').set('X-Tenant-Slug', tenantSlug).send({ email: `owner-${RUN}@e2e.test`, password: PASSWORD }).expect(200)
    ).body.data.access_token;
    propertyId = (
      await request(http).post('/api/v1/properties').set(auth()).send({ name: 'P', property_type: 'HOMESTAY', address_line: 'a', province: 'Đà Nẵng' }).expect(201)
    ).body.data.id;
    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id as string;

    // Rollup 2 ngày quá khứ (2026-06-01, 02): mỗi ngày 10 phòng / 6 occupied / 6tr doanh thu
    await admin.query(
      `INSERT INTO daily_property_stats (tenant_id, property_id, stat_date, available_room_nights, occupied_room_nights, room_revenue_vnd, other_revenue_vnd, adr_vnd, revpar_vnd)
       VALUES ($1,$2,'2026-06-01',10,6,6000000,0,1000000,600000), ($1,$2,'2026-06-02',10,6,6000000,0,1000000,600000)`,
      [tenantId, propertyId],
    );

    // Expenses trong [2026-06-01, 02]
    const mkExpense = (type: string, amount: number, date: string) =>
      request(http).post('/api/v1/expenses').set(auth()).send({ property_id: propertyId, expense_type: type, amount_vnd: amount, expense_date: date }).expect(201);
    await mkExpense('RENT_LANDLORD', 5_000_000, '2026-06-01'); // direct
    await mkExpense('ELECTRICITY', 1_000_000, '2026-06-01'); // direct + variable
    await mkExpense('STAFF_SALARY', 3_000_000, '2026-06-02'); // operating + fixed
    await mkExpense('MARKETING', 500_000, '2026-06-02'); // operating

    // Asset + 1 dòng khấu hao kỳ 2026-06 = 800,000 (operating)
    const assetId = (
      await request(http)
        .post('/api/v1/assets')
        .set(auth())
        .send({ property_id: propertyId, name: 'Máy lạnh', purchase_value_vnd: 9_600_000, purchase_date: '2026-01-01', depreciation_months: 12 })
        .expect(201)
    ).body.data.id;
    await admin.query(
      `INSERT INTO depreciation_entries (tenant_id, asset_id, period_year, period_month, amount_vnd, accumulated_vnd, book_value_vnd)
       VALUES ($1,$2,2026,6,800000,800000,8800000)`,
      [tenantId, assetId],
    );
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM daily_property_stats WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM depreciation_entries WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM assets WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM operational_expenses WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await app?.close();
  });

  it('★ GET /reports/pnl — doanh thu (rollup) − chi phí trực tiếp/vận hành + khấu hao', async () => {
    const r = (
      await request(http)
        .get(`/api/v1/reports/pnl?property_id=${propertyId}&from=2026-06-01&to=2026-06-02`)
        .set(auth())
        .expect(200)
    ).body.data;

    expect(r.revenue_room_vnd).toBe(12_000_000); // 2 × 6tr
    expect(r.revenue_total_vnd).toBe(12_000_000);
    expect(r.direct_cost_vnd).toBe(6_000_000); // RENT 5tr + ĐIỆN 1tr
    expect(r.gross_profit_vnd).toBe(6_000_000);
    expect(r.depreciation_vnd).toBe(800_000);
    expect(r.operating_cost_vnd).toBe(4_300_000); // lương 3tr + marketing 500k + khấu hao 800k
    expect(r.operating_profit_vnd).toBe(1_700_000);
    expect(r.net_profit_vnd).toBe(1_700_000);
    // occupancy
    expect(r.occupied_room_nights).toBe(12);
    expect(r.available_room_nights).toBe(20);
    expect(r.occupancy_rate_pct).toBe(60);
    expect(r.adr_vnd).toBe(1_000_000); // 12tr / 12
    expect(r.revpar_vnd).toBe(600_000); // 12tr / 20
    expect(r.expense_by_type).toMatchObject({
      RENT_LANDLORD: 5_000_000,
      ELECTRICITY: 1_000_000,
      STAFF_SALARY: 3_000_000,
      MARKETING: 500_000,
      DEPRECIATION: 800_000,
    });
  });

  it('★ GET /reports/break-even — F_fixed/V_day + occupancy hoà vốn 3 kịch bản', async () => {
    const r = (
      await request(http).get(`/api/v1/reports/break-even?property_id=${propertyId}&period=2026-06`).set(auth()).expect(200)
    ).body.data;

    expect(r.current_occupancy_pct).toBe(60); // 12/20
    expect(r.current_adr_vnd).toBe(1_000_000);
    expect(r.current_revpar_vnd).toBe(600_000);
    // F_fixed = thuê 5tr + lương 3tr + khấu hao 800k = 8,800,000
    expect(r.fixed_cost_vnd).toBe(8_800_000);
    // V_day = điện 1tr / 12 occupied = 83,333
    expect(r.variable_cost_per_night_vnd).toBe(83_333);
    // ADR lịch sử chỉ có 1tr → cả 3 kịch bản = 1,000,000
    expect(r.scenarios.realistic.adr_vnd).toBe(1_000_000);
    expect(r.scenarios.pessimistic.adr_vnd).toBe(1_000_000);
    expect(r.scenarios.optimistic.adr_vnd).toBe(1_000_000);
    // BEP = 8.8tr / ((1tr − 83,333) × 20) × 100 ≈ 48%
    expect(r.scenarios.realistic.break_even_occupancy_pct).toBe(48);
  });
});
