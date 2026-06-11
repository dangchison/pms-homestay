import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@core/tenancy/with-tenant';

/**
 * Task 1.6 acceptance: soft-delete default filter qua Prisma Client Extension
 * (deleted_at IS NULL tự chèn cho model trong SOFT_DELETABLE_MODELS) —
 * test trên bảng users thật. Caller chủ động where deleted_at thì extension
 * không can thiệp (đường ?include_deleted của docs/05).
 */
describe('Soft-delete extension (task 1.6)', () => {
  let admin: Client;
  let prisma: PrismaClient;
  let tenantId: string;

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();
    const { rows } = await admin.query(`
      INSERT INTO tenants (slug, display_name, status)
      VALUES ('softdel-test', 'SoftDelete Test', 'ACTIVE')
      ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id`);
    tenantId = rows[0].id;

    prisma = new PrismaClient();
    await prisma.$connect();

    await withTenant(prisma, tenantId, async (tx) => {
      await tx.users.create({
        data: {
          tenant_id: tenantId,
          email: 'live@softdel.test',
          password_hash: 'x',
          full_name: 'Live User',
          default_role: 'STAFF',
        },
      });
      await tx.users.create({
        data: {
          tenant_id: tenantId,
          email: 'gone@softdel.test',
          password_hash: 'x',
          full_name: 'Deleted User',
          default_role: 'STAFF',
          deleted_at: new Date(),
        },
      });
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (admin) {
      await admin.query(`DELETE FROM users WHERE tenant_id = $1`, [tenantId]);
      await admin.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
      await admin.end();
    }
  });

  it('findMany mặc định chỉ trả bản ghi sống', async () => {
    const rows = await withTenant(prisma, tenantId, (tx) => tx.users.findMany());
    expect(rows.map((r) => r.email)).toEqual(['live@softdel.test']);
  });

  it('findFirst mặc định bỏ qua bản ghi đã soft-delete', async () => {
    const row = await withTenant(prisma, tenantId, (tx) =>
      tx.users.findFirst({ where: { email: 'gone@softdel.test' } }),
    );
    expect(row).toBeNull();
  });

  it('count mặc định chỉ đếm bản ghi sống', async () => {
    const count = await withTenant(prisma, tenantId, (tx) => tx.users.count());
    expect(count).toBe(1);
  });

  it('caller chủ động filter deleted_at thì thấy được bản ghi đã xoá (include_deleted)', async () => {
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.users.findMany({ where: { deleted_at: { not: null } } }),
    );
    expect(rows.map((r) => r.email)).toEqual(['gone@softdel.test']);
  });

  it('partial unique cho phép tái tạo email đã soft-delete (uq_users_tenant_email_live)', async () => {
    await withTenant(prisma, tenantId, (tx) =>
      tx.users.create({
        data: {
          tenant_id: tenantId,
          email: 'gone@softdel.test', // email trùng bản ghi ĐÃ XOÁ → hợp lệ
          password_hash: 'x',
          full_name: 'Reborn User',
          default_role: 'STAFF',
        },
      }),
    );
    const count = await withTenant(prisma, tenantId, (tx) => tx.users.count());
    expect(count).toBe(2);

    // còn email trùng bản ghi SỐNG → unique violation
    await expect(
      withTenant(prisma, tenantId, (tx) =>
        tx.users.create({
          data: {
            tenant_id: tenantId,
            email: 'live@softdel.test',
            password_hash: 'x',
            full_name: 'Dup',
            default_role: 'STAFF',
          },
        }),
      ),
    ).rejects.toThrow();
  });
});
