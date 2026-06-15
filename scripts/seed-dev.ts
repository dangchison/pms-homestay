/**
 * Seed DEV: tenant + TÀI KHOẢN DEMO để thử nghiệm local / demo cho khách hàng
 * (marketing). KHÔNG chạy ở production. Idempotent — upsert theo slug/email/name.
 *
 * Sau khi chạy, đăng nhập web-admin (OWNER) / web-staff (lễ tân, buồng phòng) bằng
 * tenant `demo` + email dưới đây + cùng 1 mật khẩu. Đặt NEXT_PUBLIC_DEFAULT_TENANT_SLUG=demo
 * để login localhost nhận đúng tenant (web-admin không có ô nhập tenant).
 *
 * Chạy: pnpm db:seed:dev (sau pnpm db:seed:required)
 */
import 'dotenv/config';
import * as argon2 from 'argon2';
import { Client } from 'pg';

const TENANT_SLUG = 'demo';
/** Mật khẩu demo dùng chung (≥10 ký tự theo LoginRequestSchema). Đổi nếu công khai. */
const DEMO_PASSWORD = 'Demo@2026!';

/** Tài khoản demo theo từng vai trò — showcase web-admin (OWNER) + web-staff (STAFF/HOUSEKEEPER). */
const DEMO_USERS = [
  { email: 'owner@demo.vn', fullName: 'Chủ nhà Demo', role: 'OWNER', scopedToProperty: false },
  { email: 'letan@demo.vn', fullName: 'Lễ tân Demo', role: 'STAFF', scopedToProperty: true },
  { email: 'buongphong@demo.vn', fullName: 'Buồng phòng Demo', role: 'HOUSEKEEPER', scopedToProperty: true },
] as const;

const PROPERTY_NAME = 'Cơ sở Demo — Mỹ Khê';

async function upsertUser(
  client: Client,
  tenantId: string,
  email: string,
  fullName: string,
  role: string,
  passwordHash: string,
): Promise<string> {
  // partial unique (tenant_id, email) WHERE deleted_at IS NULL → upsert thủ công.
  const updated = await client.query<{ id: string }>(
    `UPDATE users
       SET full_name = $3, default_role = $4, password_hash = $5, is_active = true
     WHERE tenant_id = $1 AND email = $2 AND deleted_at IS NULL
     RETURNING id`,
    [tenantId, email, fullName, role, passwordHash],
  );
  if (updated.rowCount && updated.rowCount > 0) return updated.rows[0]!.id;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email, full_name, default_role, password_hash, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING id`,
    [tenantId, email, fullName, role, passwordHash],
  );
  return inserted.rows[0]!.id;
}

async function main(): Promise<void> {
  // Dùng role migrations (postgres superuser) — seed bảng tenant-scoped (users/
  // properties/user_property_roles có RLS) cần bypass RLS; app_user sẽ bị WITH CHECK
  // chặn vì không set app.current_tenant_id. Fallback DATABASE_URL nếu thiếu.
  const url = process.env.DATABASE_URL_MIGRATIONS ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Thiếu DATABASE_URL_MIGRATIONS/DATABASE_URL (cp .env.example .env)');

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows: plans } = await client.query<{ id: string }>(
      `SELECT id FROM subscription_plans WHERE code = 'PRO'`,
    );
    const planId = plans[0]?.id;
    if (!planId) throw new Error('Chưa có subscription plan — chạy pnpm db:seed:required trước');

    // 1) Tenant demo (ACTIVE, gói PRO).
    const { rows: tenantRows } = await client.query<{ id: string }>(
      `INSERT INTO tenants (slug, display_name, business_type, status, subscription_plan_id)
       VALUES ($1, 'Demo Homestay Đà Nẵng', 'HOMESTAY', 'ACTIVE', $2)
       ON CONFLICT (slug) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         status = EXCLUDED.status,
         subscription_plan_id = EXCLUDED.subscription_plan_id
       RETURNING id`,
      [TENANT_SLUG, planId],
    );
    const tenantId = tenantRows[0]!.id;

    // 2) Cơ sở demo (để lễ tân/buồng phòng có phạm vi; phòng/booking thêm qua UI).
    const existingProp = await client.query<{ id: string }>(
      `SELECT id FROM properties WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL`,
      [tenantId, PROPERTY_NAME],
    );
    const propertyId =
      existingProp.rows[0]?.id ??
      (
        await client.query<{ id: string }>(
          `INSERT INTO properties (tenant_id, name, address_line, province, property_type)
           VALUES ($1, $2, '15 Võ Nguyên Giáp, Mỹ Khê', 'Đà Nẵng', 'HOMESTAY')
           RETURNING id`,
          [tenantId, PROPERTY_NAME],
        )
      ).rows[0]!.id;

    // 3) Tài khoản demo theo vai trò (cùng mật khẩu).
    const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
    for (const u of DEMO_USERS) {
      const userId = await upsertUser(client, tenantId, u.email, u.fullName, u.role, passwordHash);
      if (u.scopedToProperty) {
        await client.query(
          `INSERT INTO user_property_roles (tenant_id, user_id, property_id, role)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, property_id, role) DO NOTHING`,
          [tenantId, userId, propertyId, u.role],
        );
      }
    }

    console.log('✅ Seed dev xong:');
    console.log(`   Tenant : ${TENANT_SLUG} (Demo Homestay Đà Nẵng, gói PRO)`);
    console.log(`   Cơ sở  : ${PROPERTY_NAME}`);
    console.log(`   Mật khẩu chung: ${DEMO_PASSWORD}`);
    for (const u of DEMO_USERS) console.log(`   - ${u.role.padEnd(11)} ${u.email}`);
    console.log('   ⚠️  Đặt NEXT_PUBLIC_DEFAULT_TENANT_SLUG=demo để login localhost.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌ Seed dev thất bại:', err);
  process.exit(1);
});
