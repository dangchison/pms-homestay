import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentCounterService } from '@core/counters/document-counter.service';
import { withTenant } from '@core/tenancy/with-tenant';

/**
 * ★ Acceptance task 3.1: sinh số chứng từ ATOMIC, KHÔNG gap dưới đồng thời cao
 * (UPSERT + row lock). Chạy bằng app_user qua withTenant (RLS thật).
 */
describe('DocumentCounterService — atomic, no gap (task 3.1)', () => {
  const counter = new DocumentCounterService();
  let admin: Client;
  let prisma: PrismaClient;
  let tenantId: string;

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();
    prisma = new PrismaClient();
    await prisma.$connect();
    tenantId = (
      await admin.query(
        `INSERT INTO tenants (slug, display_name, status) VALUES ($1, 'DC', 'ACTIVE') RETURNING id`,
        [`dc-${process.pid}${Date.now() % 100000}`],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    if (admin) {
      await admin.query(`DELETE FROM document_counters WHERE tenant_id = $1`, [tenantId]);
      await admin.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
      await admin.end();
    }
    await prisma?.$disconnect();
  });

  it('100 concurrent next() → 100 số liên tục 1..100, không gap/trùng', async () => {
    const tasks = Array.from({ length: 100 }, () =>
      withTenant(prisma, tenantId, (tx) => counter.next(tx, tenantId, 'BK', '202606')),
    );
    const values = await Promise.all(tasks);
    const unique = new Set(values);
    expect(unique.size).toBe(100); // không trùng
    expect(Math.min(...values)).toBe(1);
    expect(Math.max(...values)).toBe(100); // không gap
  });

  it('nextCode format BK-YYYYMM-0001; period khác nhau đếm độc lập', async () => {
    const code = await withTenant(prisma, tenantId, (tx) =>
      counter.nextCode(tx, tenantId, 'BK', '202607'),
    );
    expect(code).toBe('BK-202607-0001');
    const inv = await withTenant(prisma, tenantId, (tx) =>
      counter.nextCode(tx, tenantId, 'INV', '202607'),
    );
    expect(inv).toBe('INV-202607-0001'); // type khác → đếm riêng
  });
});
