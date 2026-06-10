/**
 * Seed DEV: tenant demo để thử nghiệm local (KHÔNG chạy ở production).
 * Idempotent — upsert theo slug.
 *
 * Chạy: pnpm db:seed:dev (sau pnpm db:seed:required)
 */
import 'dotenv/config';
import { Client } from 'pg';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Thiếu DATABASE_URL (cp .env.example .env)');

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows: plans } = await client.query(
      `SELECT id FROM subscription_plans WHERE code = 'PRO'`,
    );
    const planId = plans[0]?.id;
    if (!planId) throw new Error('Chưa có subscription plan — chạy pnpm db:seed:required trước');

    await client.query(
      `INSERT INTO tenants (slug, display_name, business_type, status, subscription_plan_id)
       VALUES ('demo', 'Demo Homestay Đà Nẵng', 'HOMESTAY', 'ACTIVE', $1)
       ON CONFLICT (slug) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         status = EXCLUDED.status,
         subscription_plan_id = EXCLUDED.subscription_plan_id`,
      [planId],
    );
    const { rows } = await client.query(
      `SELECT slug, status FROM tenants WHERE slug = 'demo'`,
    );
    console.log(`✅ Seed dev xong: tenant ${rows[0].slug} (${rows[0].status})`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌ Seed dev thất bại:', err);
  process.exit(1);
});
