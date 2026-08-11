import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AssetsService } from '@modules/assets/assets.service';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';
import { setTenantPlan } from '../helpers/plan';

/**
 * ★ Acceptance task 3.5 (docs/03 §4.7, docs/09 §7): CRUD tài sản; khấu hao
 * đường thẳng với THÁNG CUỐI = plug (accumulated == nguyên giá − residual, triệt
 * tiêu lệch làm tròn); pro-rate tháng đầu theo số ngày sở hữu; createMany
 * skipDuplicates → chạy lại không sinh đôi; thanh lý giữa kỳ → dừng sinh kỳ sau.
 *
 * runMonthlyDepreciation gọi thẳng AssetsService (như hold-expiry cron) — cron
 * tháng do night-audit (4.6) lên lịch sau.
 */

const RUN = `${process.pid}${Date.now() % 100000}`;
const PASSWORD = 'S3cure!Passw0rd-dev';
const tenantSlug = `asset-${RUN}`;

describe('Assets & Depreciation (task 3.5)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let admin: Client;
  let token: string;
  let propertyId: string;
  let tenantId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  interface AssetData {
    id: string;
    depreciation_method: string;
    residual_value_vnd: number;
    purchase_date: string;
    disposal_date: string | null;
    disposal_value_vnd: number | null;
    name: string;
  }
  interface EntryData {
    period_year: number;
    period_month: number;
    amount_vnd: number;
    accumulated_vnd: number;
    book_value_vnd: number;
  }

  const createAsset = async (body: Record<string, unknown>): Promise<AssetData> =>
    (await request(http).post('/api/v1/assets').set(auth()).send(body).expect(201)).body.data;

  const depreciationOf = async (assetId: string): Promise<EntryData[]> =>
    (await request(http).get(`/api/v1/assets/${assetId}/depreciation`).set(auth()).expect(200)).body.data;

  const runDep = (year: number, month: number) =>
    app.get(AssetsService).runMonthlyDepreciation(tenantId, year, month);

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
        tenant_display_name: 'ASSET E2E',
        email: `owner-${RUN}@e2e.test`,
        password: PASSWORD,
        full_name: 'Owner',
      })
      .expect(201);
    // Tài sản + khấu hao là tính năng gói PRO trở lên (PlanFeatureGuard).
    await setTenantPlan(admin, tenantSlug, 'PRO');
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

    tenantId = (await admin.query(`SELECT id FROM tenants WHERE slug = $1`, [tenantSlug])).rows[0].id as string;
  });

  afterAll(async () => {
    if (admin) {
      const tid = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
      await admin.query(`DELETE FROM depreciation_entries WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM assets WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM user_property_roles WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM properties WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM refresh_tokens WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM users WHERE tenant_id IN ${tid}`);
      await admin.query(`DELETE FROM tenants WHERE slug = $1`, [tenantSlug]);
      await admin.end();
    }
    await app?.close();
  });

  it('CRUD: tạo → get → list → update → dispose (409 khi lặp) → soft-delete; 422 residual > nguyên giá', async () => {
    const a = await createAsset({
      property_id: propertyId,
      name: 'Máy lạnh Daikin',
      category: 'APPLIANCE',
      purchase_value_vnd: 12_000_000,
      purchase_date: '2026-01-01',
      depreciation_months: 12,
    });
    expect(a.depreciation_method).toBe('STRAIGHT_LINE');
    expect(a.residual_value_vnd).toBe(0);
    expect(a.purchase_date).toBe('2026-01-01');

    const got = (await request(http).get(`/api/v1/assets/${a.id}`).set(auth()).expect(200)).body.data;
    expect(got.name).toBe('Máy lạnh Daikin');

    const list = (
      await request(http).get(`/api/v1/assets?property_id=${propertyId}`).set(auth()).expect(200)
    ).body;
    expect(list.data.some((x: AssetData) => x.id === a.id)).toBe(true);
    expect(list.page_info.total_items).toBeGreaterThanOrEqual(1);

    const upd = (
      await request(http).patch(`/api/v1/assets/${a.id}`).set(auth()).send({ name: 'Máy lạnh Daikin 1HP' }).expect(200)
    ).body.data;
    expect(upd.name).toBe('Máy lạnh Daikin 1HP');

    const disp = (
      await request(http)
        .post(`/api/v1/assets/${a.id}/dispose`)
        .set(auth())
        .send({ disposal_date: '2026-06-30', disposal_value_vnd: 2_000_000 })
        .expect(200)
    ).body.data;
    expect(disp.disposal_date).toBe('2026-06-30');
    expect(disp.disposal_value_vnd).toBe(2_000_000);

    // thanh lý lần 2 → 409
    const again = await request(http)
      .post(`/api/v1/assets/${a.id}/dispose`)
      .set(auth())
      .send({ disposal_date: '2026-07-01', disposal_value_vnd: 1 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ASSET_ALREADY_DISPOSED');

    // soft-delete → get 404
    await request(http).delete(`/api/v1/assets/${a.id}`).set(auth()).expect(204);
    await request(http).get(`/api/v1/assets/${a.id}`).set(auth()).expect(404);

    // residual > nguyên giá → 400 VALIDATION_FAILED (refine Zod chạy trước service)
    const bad = await request(http).post('/api/v1/assets').set(auth()).send({
      property_id: propertyId,
      name: 'x',
      purchase_value_vnd: 1_000_000,
      purchase_date: '2026-01-01',
      depreciation_months: 12,
      residual_value_vnd: 2_000_000,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('★ khấu hao đủ kỳ: tháng cuối plug → accumulated == nguyên giá, book_value == residual (triệt tiêu lệch làm tròn)', async () => {
    // 10,000,000 / 3 = 3,333,333.33 → 2 tháng đầu 3,333,333; tháng cuối plug 3,333,334
    const a = await createAsset({
      property_id: propertyId,
      name: 'TS chia lẻ',
      purchase_value_vnd: 10_000_000,
      purchase_date: '2026-01-01', // ngày 1 → tháng đầu không bị pro-rate (31/31)
      depreciation_months: 3,
    });
    for (const m of [1, 2, 3]) await runDep(2026, m);

    const entries = await depreciationOf(a.id);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.amount_vnd)).toEqual([3_333_333, 3_333_333, 3_333_334]);
    expect(entries.map((e) => e.accumulated_vnd)).toEqual([3_333_333, 6_666_666, 10_000_000]);
    expect(entries.at(-1)!.accumulated_vnd).toBe(10_000_000); // == nguyên giá − residual(0)
    expect(entries.at(-1)!.book_value_vnd).toBe(0); // == residual
    expect(entries.reduce((s, e) => s + e.amount_vnd, 0)).toBe(10_000_000); // tổng == base
  });

  it('★ pro-rate tháng đầu theo số ngày sở hữu', async () => {
    // mua 16/01 (sở hữu 16/31 ngày): (3,100,000/2) × 16/31 = 800,000; tháng cuối plug
    const a = await createAsset({
      property_id: propertyId,
      name: 'TS mua giữa tháng',
      purchase_value_vnd: 3_100_000,
      purchase_date: '2026-01-16',
      depreciation_months: 2,
    });
    await runDep(2026, 1);
    await runDep(2026, 2);

    const entries = await depreciationOf(a.id);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.amount_vnd).toBe(800_000); // tháng đầu pro-rate
    expect(entries[1]!.amount_vnd).toBe(2_300_000); // plug = 3,100,000 − 800,000
    expect(entries[1]!.accumulated_vnd).toBe(3_100_000);
    expect(entries[1]!.book_value_vnd).toBe(0);
  });

  it('chạy lại cùng kỳ KHÔNG sinh đôi (createMany skipDuplicates)', async () => {
    const a = await createAsset({
      property_id: propertyId,
      name: 'TS idempotent',
      purchase_value_vnd: 6_000_000,
      purchase_date: '2026-01-01',
      depreciation_months: 6,
    });
    const first = await runDep(2026, 1);
    expect(first.entries_created).toBeGreaterThanOrEqual(1);
    const before = (await depreciationOf(a.id)).length;
    expect(before).toBe(1);

    await runDep(2026, 1); // chạy lại cùng kỳ
    expect((await depreciationOf(a.id)).length).toBe(before); // không sinh thêm
  });

  it('★ thanh lý giữa kỳ → dừng sinh khấu hao từ kỳ sau', async () => {
    const a = await createAsset({
      property_id: propertyId,
      name: 'TS thanh lý',
      purchase_value_vnd: 12_000_000,
      purchase_date: '2026-01-01',
      depreciation_months: 12,
    });
    await runDep(2026, 1);
    await runDep(2026, 2);
    expect(await depreciationOf(a.id)).toHaveLength(2);

    await request(http)
      .post(`/api/v1/assets/${a.id}/dispose`)
      .set(auth())
      .send({ disposal_date: '2026-02-15', disposal_value_vnd: 9_000_000 })
      .expect(200);

    await runDep(2026, 3); // tenant-wide, nhưng asset đã thanh lý bị loại
    expect(await depreciationOf(a.id)).toHaveLength(2); // vẫn 2 — không sinh kỳ 03
  });
});
