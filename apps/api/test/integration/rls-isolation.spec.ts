import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@core/tenancy/with-tenant';

/**
 * ★ Test acceptance task 1.5: RLS isolation THẬT trên PostgreSQL local.
 *
 * Dùng bảng thử rls_probe (tạo trong setup) vì bảng nghiệp vụ RLS đầu tiên
 * (users) thuộc task 1.6. Bảng thử đi đúng template enforce_tenant_isolation()
 * của migration 0001 — chính là policy mọi bảng tenant-scoped sẽ dùng.
 *
 * QUAN TRỌNG: client app chạy bằng app_user (non-superuser) — superuser
 * bypass RLS nên test bằng postgres là vô nghĩa.
 */

interface ProbeRow {
  tenant_id: string;
  note: string;
}

describe('withTenant + RLS isolation (task 1.5)', () => {
  let admin: Client; // postgres (owner) — setup/teardown
  let prisma: PrismaClient; // app_user — client như API runtime
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();

    // Bảng thử dùng đúng RLS template chuẩn của hệ thống
    await admin.query(`DROP TABLE IF EXISTS rls_probe`);
    await admin.query(`
      CREATE TABLE rls_probe (
        id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        note      TEXT NOT NULL
      )`);
    await admin.query(`SELECT enforce_tenant_isolation('rls_probe')`);
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON rls_probe TO app_user`);

    const { rows } = await admin.query(`
      INSERT INTO tenants (slug, display_name, status)
      VALUES ('rls-test-a', 'RLS Test A', 'ACTIVE'), ('rls-test-b', 'RLS Test B', 'ACTIVE')
      ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id, slug`);
    tenantA = rows.find((r: { slug: string }) => r.slug === 'rls-test-a')!.id;
    tenantB = rows.find((r: { slug: string }) => r.slug === 'rls-test-b')!.id;

    await admin.query(
      `INSERT INTO rls_probe (tenant_id, note) VALUES ($1, 'A-secret'), ($2, 'B-secret')`,
      [tenantA, tenantB],
    );

    prisma = new PrismaClient(); // DATABASE_URL = app_user
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (admin) {
      await admin.query(`DROP TABLE IF EXISTS rls_probe`);
      await admin.query(`DELETE FROM tenants WHERE slug IN ('rls-test-a', 'rls-test-b')`);
      await admin.end();
    }
  });

  it('tenant A chỉ thấy dữ liệu của A', async () => {
    const rows = await withTenant(prisma, tenantA, (tx) =>
      tx.$queryRaw<ProbeRow[]>`SELECT tenant_id, note FROM rls_probe ORDER BY note`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.note).toBe('A-secret');
  });

  it('tenant B chỉ thấy dữ liệu của B', async () => {
    const rows = await withTenant(prisma, tenantB, (tx) =>
      tx.$queryRaw<ProbeRow[]>`SELECT tenant_id, note FROM rls_probe ORDER BY note`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.note).toBe('B-secret');
  });

  it('FAIL-CLOSED: query ngoài withTenant (GUC chưa set) → 0 rows', async () => {
    const rows = await prisma.$queryRaw<ProbeRow[]>`SELECT tenant_id, note FROM rls_probe`;
    expect(rows).toHaveLength(0);
  });

  it('INTERLEAVED: 2 tenant context chạy đồng thời không rò rỉ (acceptance 1.5)', async () => {
    const runs = 5;
    const tasks: Promise<{ who: string; notes: string[] }>[] = [];
    for (let i = 0; i < runs; i++) {
      tasks.push(
        withTenant(prisma, tenantA, async (tx) => {
          await tx.$executeRawUnsafe(`SELECT pg_sleep(0.03)`);
          const rows = await tx.$queryRaw<ProbeRow[]>`SELECT note FROM rls_probe`;
          return { who: 'A', notes: rows.map((r) => r.note) };
        }),
        withTenant(prisma, tenantB, async (tx) => {
          await tx.$executeRawUnsafe(`SELECT pg_sleep(0.03)`);
          const rows = await tx.$queryRaw<ProbeRow[]>`SELECT note FROM rls_probe`;
          return { who: 'B', notes: rows.map((r) => r.note) };
        }),
      );
    }
    const results = await Promise.all(tasks);
    for (const result of results) {
      expect(result.notes).toEqual(result.who === 'A' ? ['A-secret'] : ['B-secret']);
    }
  });

  it('WITH CHECK chặn ghi chéo tenant: A insert row mang tenant_id của B → lỗi RLS', async () => {
    await expect(
      withTenant(prisma, tenantA, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO rls_probe (tenant_id, note) VALUES ($1::uuid, 'A-forges-B')`,
          tenantB,
        ),
      ),
    ).rejects.toThrow(/row-level security|42501/i);
  });

  it('ghi đúng tenant của mình thì thành công', async () => {
    await withTenant(prisma, tenantA, (tx) =>
      tx.$executeRawUnsafe(
        `INSERT INTO rls_probe (tenant_id, note) VALUES ($1::uuid, 'A-own-write')`,
        tenantA,
      ),
    );
    const rows = await withTenant(prisma, tenantA, (tx) =>
      tx.$queryRaw<ProbeRow[]>`SELECT note FROM rls_probe ORDER BY note`,
    );
    expect(rows.map((r) => r.note)).toEqual(['A-own-write', 'A-secret']);
  });

  it('opts.readOnly: mutation trong transaction READ ONLY bị từ chối', async () => {
    await expect(
      withTenant(
        prisma,
        tenantA,
        (tx) => tx.$executeRawUnsafe(`INSERT INTO rls_probe (tenant_id, note) VALUES ($1::uuid, 'x')`, tenantA),
        { readOnly: true },
      ),
    ).rejects.toThrow(/read-only|25006/i);
  });

  it('tenantId không phải UUID → từ chối ngay (không chạm DB)', async () => {
    await expect(withTenant(prisma, 'not-a-uuid', async () => 'x')).rejects.toThrow(/UUID/);
  });
});
